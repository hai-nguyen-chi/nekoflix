import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ALL_EVENT_TYPES,
  EVENT_FIXTURES,
  EVENT_REGISTRY,
  eventSubject,
  eventTypeFromSubject,
  eventEnvelopeSchema,
  isKnownEventType,
  parseEventData,
} from '../src/index';
import { RPC_REGISTRY } from '../src/rpc/index';
import { describeSchema } from './schema-shape';

/**
 * Kiểm tra bản thân HỢP ĐỒNG, trước khi kiểm tra ai tuân thủ nó.
 *
 * Những test này không cần database, không cần NATS — chúng chỉ đọc
 * registry. Nhưng chúng bắt được lớp lỗi khó chịu nhất: thêm event mới mà
 * quên đăng ký, hoặc đăng ký với tên không theo quy ước, khiến consumer
 * subscribe hụt và event rơi vào im lặng.
 */

describe('Registry của event', () => {
  it('tên event theo đúng quy ước <bounded-context>.<aggregate>.<action>', () => {
    for (const type of ALL_EVENT_TYPES) {
      // Tên tự do thì subject NATS cũng tự do, và wildcard subscribe
      // (`nekoflix.events.identity.>`) ngừng hoạt động một cách âm thầm.
      expect(type, `${type} sai quy ước`).toMatch(/^[a-z]+(\.[a-z][a-z_]*){2}$/);
    }
  });

  it('mọi event đều có version là số nguyên dương', () => {
    for (const [type, entry] of Object.entries(EVENT_REGISTRY)) {
      expect(Number.isInteger(entry.version), `${type} version không phải số nguyên`).toBe(true);
      expect(entry.version, `${type} version phải >= 1`).toBeGreaterThanOrEqual(1);
    }
  });

  it('mọi schema event đều là object — không bao giờ là mảng hay giá trị trần', () => {
    for (const [type, entry] of Object.entries(EVENT_REGISTRY)) {
      // Payload trần (mảng, chuỗi) không thêm field được mà không phá
      // tương thích. Object thì thêm field tuỳ chọn lúc nào cũng được.
      expect(entry.schema, `${type} không phải ZodObject`).toBeInstanceOf(z.ZodObject);
    }
  });

  it('subject và event type chuyển đổi qua lại không mất mát', () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(eventTypeFromSubject(eventSubject(type))).toBe(type);
    }
  });

  it('isKnownEventType từ chối event lạ', () => {
    expect(isKnownEventType('identity.user.registered')).toBe(true);
    // Tên vô nghĩa có chủ đích. Dùng một event CÓ TRONG ROADMAP làm ví dụ
    // "không tồn tại" thì test sẽ đỏ đúng ngày ai đó cài đặt nó — đã xảy ra
    // một lần với `catalog.title.published`.
    expect(isKnownEventType('khongcogi.khong.ton_tai')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Fixture mẫu', () => {
  it('có fixture cho MỌI event đã đăng ký', () => {
    // Thiếu fixture nghĩa là contract test của consumer không phủ được
    // event đó — và không ai nhận ra cho tới lúc chạy thật.
    expect(Object.keys(EVENT_FIXTURES).sort()).toEqual([...ALL_EVENT_TYPES].sort());
  });

  it('mọi fixture đều parse được bằng schema của chính nó', () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(() => parseEventData(type, EVENT_FIXTURES[type]), type).not.toThrow();
    }
  });

  it('fixture bọc trong envelope vẫn hợp lệ', () => {
    for (const type of ALL_EVENT_TYPES) {
      const envelope = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type,
        version: EVENT_REGISTRY[type].version,
        occurredAt: '2026-01-15T08:30:00.000Z',
        producer: 'identity-service@0.1.0',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        correlationId: 'req-1',
        causationId: null,
        data: EVENT_FIXTURES[type],
      };
      expect(() => eventEnvelopeSchema.parse(envelope), type).not.toThrow();
    }
  });

  it('fixture không lọt field thừa mà schema sẽ âm thầm cắt bỏ', () => {
    for (const type of ALL_EVENT_TYPES) {
      // Zod mặc định STRIP field lạ. Fixture có field thừa sẽ trông như
      // chạy tốt trong test, rồi biến mất trên đường truyền thật.
      const parsed = parseEventData(type, EVENT_FIXTURES[type]);
      expect(Object.keys(parsed).sort(), type).toEqual(Object.keys(EVENT_FIXTURES[type]).sort());
    }
  });
});

// ═══════════════════════════════════════════════════════════════
describe('Registry của RPC', () => {
  it('subject bắt đầu bằng tên service và có 2–3 đoạn', () => {
    for (const subject of Object.keys(RPC_REGISTRY)) {
      // Đoạn đầu phải là tên service: NATS queue group và quyền truy cập
      // đều gom theo prefix này.
      expect(subject, `${subject} sai quy ước`).toMatch(/^[a-z]+(\.[a-zA-Z]+){1,2}$/);
    }
  });

  it('mọi subject đều khai báo CẢ request lẫn response', () => {
    for (const [subject, entry] of Object.entries(RPC_REGISTRY)) {
      expect(entry.request, `${subject} thiếu request`).toBeInstanceOf(z.ZodType);
      expect(entry.response, `${subject} thiếu response`).toBeInstanceOf(z.ZodType);
    }
  });

  it('không response nào để lọt field nhạy cảm, kể cả ở tầng lồng sâu', () => {
    // Schema response là thứ CUỐI CÙNG chặn dữ liệu nhạy cảm trước khi nó
    // rời service. Thêm `passwordHash` vào publicUser cho tiện debug là
    // cách rò rỉ hash mật khẩu ra tận trình duyệt.
    const FORBIDDEN = /^(password|passwordHash|pinHash|tokenHash|secret|clientSecret)$/i;

    for (const [subject, entry] of Object.entries(RPC_REGISTRY)) {
      for (const path of Object.keys(describeSchema(entry.response))) {
        const leaf = path.split('.').pop()!.replace('[]', '');
        expect(FORBIDDEN.test(leaf), `${subject} trả về field nhạy cảm: ${path}`).toBe(false);
      }
    }
  });
});
