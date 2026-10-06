import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { checkBackwardCompatible, describeSchema } from './schema-shape';

/**
 * Test cho chính công cụ kiểm tra tương thích.
 *
 * Nếu `checkBackwardCompatible` hỏng theo hướng "luôn nói compatible", mọi
 * test tương thích ngược khác sẽ xanh mãi mãi trong khi không kiểm tra gì
 * cả. Lưới an toàn cũng cần được kiểm tra.
 */

const BEFORE = z.object({
  id: z.string(),
  count: z.number().int(),
  status: z.enum(['active', 'revoked']),
  note: z.string().optional(),
});

const shapeOf = describeSchema;
const check = (after: z.ZodTypeAny) => checkBackwardCompatible(shapeOf(BEFORE), shapeOf(after));

describe('describeSchema', () => {
  it('làm phẳng object lồng nhau thành đường dẫn có dấu chấm', () => {
    const shape = shapeOf(z.object({ user: z.object({ id: z.string() }) }));

    expect(Object.keys(shape).sort()).toEqual(['user', 'user.id']);
    expect(shape['user.id']).toEqual({ type: 'string', optional: false, nullable: false });
  });

  it('coi field có default là tuỳ chọn', () => {
    // Bên gửi được phép bỏ trống -> với bên nhận thì nó đúng là tuỳ chọn
    const shape = shapeOf(z.object({ lang: z.string().default('vi') }));
    expect(shape.lang?.optional).toBe(true);
  });

  it('bóc được nhiều lớp vỏ xếp chồng', () => {
    const shape = shapeOf(z.object({ x: z.string().nullable().optional() }));
    expect(shape.x).toEqual({ type: 'string', optional: true, nullable: true });
  });

  it('ghi lại tập giá trị của enum', () => {
    const shape = shapeOf(z.object({ s: z.enum(['b', 'a']) }));
    expect(shape.s?.values).toEqual(['a', 'b']);
  });

  it('phân biệt string thường với string có ràng buộc', () => {
    const shape = shapeOf(z.object({ a: z.string(), b: z.string().datetime() }));
    expect(shape.a?.type).toBe('string');
    expect(shape.b?.type).toBe('string<datetime>');
  });
});

describe('checkBackwardCompatible', () => {
  it('schema không đổi -> tương thích', () => {
    expect(check(BEFORE).compatible).toBe(true);
  });

  it('thêm field TUỲ CHỌN -> tương thích', () => {
    const r = check(BEFORE.extend({ extra: z.string().optional() }));
    expect(r.compatible).toBe(true);
    expect(r.additive).toContain('extra: field tuỳ chọn mới');
  });

  it('thêm field BẮT BUỘC -> phá vỡ', () => {
    // Event cũ đang nằm trong JetStream không có field này -> replay là chết
    const r = check(BEFORE.extend({ extra: z.string() }));
    expect(r.compatible).toBe(false);
    expect(r.breaking.join()).toContain('extra');
  });

  it('xoá field -> phá vỡ', () => {
    const r = check(BEFORE.omit({ count: true }));
    expect(r.compatible).toBe(false);
    expect(r.breaking.join()).toContain('count: đã bị xoá');
  });

  it('đổi kiểu -> phá vỡ', () => {
    const r = check(BEFORE.extend({ count: z.string() }));
    expect(r.compatible).toBe(false);
    expect(r.breaking.join()).toContain('kiểu đổi');
  });

  it('siết ràng buộc của string cũng tính là đổi kiểu', () => {
    const r = check(BEFORE.extend({ id: z.string().datetime() }));
    expect(r.compatible).toBe(false);
  });

  it('tuỳ chọn -> bắt buộc là phá vỡ', () => {
    const r = check(BEFORE.extend({ note: z.string() }));
    expect(r.compatible).toBe(false);
    expect(r.breaking.join()).toContain('BẮT BUỘC');
  });

  it('bắt buộc -> tuỳ chọn là rủi ro', () => {
    const r = check(BEFORE.extend({ id: z.string().optional() }));
    expect(r.compatible).toBe(false);
    expect(r.risky.join()).toContain('tuỳ chọn');
  });

  it('bỏ một giá trị enum -> phá vỡ', () => {
    const r = check(BEFORE.extend({ status: z.enum(['active']) }));
    expect(r.compatible).toBe(false);
    expect(r.breaking.join()).toContain('bỏ giá trị enum');
  });

  it('thêm một giá trị enum -> rủi ro, không im lặng cho qua', () => {
    // Zod từ chối giá trị lạ, nên consumer cũ gặp giá trị mới sẽ ném lỗi
    // và event rơi vào DLQ. Thêm enum KHÔNG phải thay đổi vô hại.
    const r = check(BEFORE.extend({ status: z.enum(['active', 'revoked', 'expired']) }));
    expect(r.compatible).toBe(false);
    expect(r.risky.join()).toContain('thêm giá trị enum');
  });

  it('gộp nhiều vấn đề trong một báo cáo', () => {
    const r = check(BEFORE.omit({ count: true }).extend({ extra: z.number() }));
    expect(r.breaking).toHaveLength(2);
  });
});
