import { z } from 'zod';

/**
 * Mô tả một Zod schema thành dạng phẳng, so sánh được giữa hai phiên bản.
 *
 * Vì sao không dùng `zod-to-json-schema`: JSON Schema mang theo rất nhiều
 * chi tiết không liên quan tới tương thích (description, $ref, title), nên
 * diff của nó ồn và dễ bị bỏ qua. Ở đây chỉ giữ đúng những thứ làm hỏng
 * bên kia: tên field, kiểu, bắt buộc hay không, và tập giá trị của enum.
 *
 * Field lồng nhau được làm phẳng thành đường dẫn có dấu chấm
 * (`session.device`), phần tử mảng thành `items[]`.
 */
export interface FieldShape {
  type: string;
  optional: boolean;
  nullable: boolean;
  /** Chỉ có với enum */
  values?: string[];
}

export type SchemaShape = Record<string, FieldShape>;

interface Unwrapped {
  inner: z.ZodTypeAny;
  optional: boolean;
  nullable: boolean;
}

/** Bóc các lớp vỏ optional/nullable/default/effects để lấy kiểu gốc */
function unwrap(schema: z.ZodTypeAny): Unwrapped {
  let inner = schema;
  let optional = false;
  let nullable = false;

  // Vòng lặp chứ không đệ quy một lần: `.optional().nullable()` xếp chồng
  // nhiều lớp, bóc một lớp sẽ bỏ sót lớp còn lại.
  for (;;) {
    const def = inner._def as { typeName: string; innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny };

    if (def.typeName === 'ZodOptional') {
      optional = true;
      inner = def.innerType!;
    } else if (def.typeName === 'ZodNullable') {
      nullable = true;
      inner = def.innerType!;
    } else if (def.typeName === 'ZodDefault') {
      // Có default nghĩa là bên gửi được phép bỏ trống
      optional = true;
      inner = def.innerType!;
    } else if (def.typeName === 'ZodEffects') {
      inner = def.schema!;
    } else {
      return { inner, optional, nullable };
    }
  }
}

/** 'string<datetime,max>' — ràng buộc nào có thể làm bên kia bị từ chối */
function stringType(schema: z.ZodString): string {
  const checks = (schema._def.checks ?? []).map((c) => c.kind).sort();
  return checks.length ? `string<${checks.join(',')}>` : 'string';
}

function numberType(schema: z.ZodNumber): string {
  const checks = (schema._def.checks ?? []).map((c) => c.kind).sort();
  return checks.length ? `number<${checks.join(',')}>` : 'number';
}

function describeInto(schema: z.ZodTypeAny, prefix: string, out: SchemaShape): void {
  const { inner, optional, nullable } = unwrap(schema);
  const def = inner._def as { typeName: string };

  const put = (type: string, values?: string[]) => {
    out[prefix] = values ? { type, optional, nullable, values } : { type, optional, nullable };
  };

  switch (def.typeName) {
    case 'ZodObject': {
      // Object lồng nhau không tự nó là một field — chỉ các lá mới là.
      // Ghi lại sự tồn tại của nó để xoá object đi vẫn bị bắt.
      put('object');
      const shape = (inner as z.ZodObject<z.ZodRawShape>).shape;
      for (const key of Object.keys(shape).sort()) {
        describeInto(shape[key]!, prefix ? `${prefix}.${key}` : key, out);
      }
      return;
    }
    case 'ZodArray': {
      put('array');
      describeInto((inner as z.ZodArray<z.ZodTypeAny>).element, `${prefix}[]`, out);
      return;
    }
    case 'ZodEnum':
      put('enum', [...(inner as z.ZodEnum<[string, ...string[]]>).options].sort());
      return;
    case 'ZodString':
      put(stringType(inner as z.ZodString));
      return;
    case 'ZodNumber':
      put(numberType(inner as z.ZodNumber));
      return;
    case 'ZodBoolean':
      put('boolean');
      return;
    case 'ZodLiteral':
      put(`literal<${JSON.stringify((inner as z.ZodLiteral<unknown>).value)}>`);
      return;
    case 'ZodRecord':
      put('record');
      return;
    case 'ZodUnknown':
    case 'ZodAny':
      put('unknown');
      return;
    default:
      put(def.typeName);
  }
}

export function describeSchema(schema: z.ZodTypeAny): SchemaShape {
  const out: SchemaShape = {};
  describeInto(schema, '', out);
  // Gốc luôn là 'object' rỗng-key, bỏ đi cho gọn
  delete out[''];
  return out;
}

// ─────────────────────────────────────────────────────────────────
export interface CompatReport {
  compatible: boolean;
  /** Chắc chắn làm chết bên kia */
  breaking: string[];
  /** Không chết ngay, nhưng chết khi hai bên deploy lệch nhau */
  risky: string[];
  /** Thêm thắt an toàn — ghi lại để biết snapshot cần cập nhật */
  additive: string[];
}

/**
 * So snapshot đã publish với schema hiện tại.
 *
 * "Tương thích ngược" ở đây nghĩa là: một service CŨ chưa kịp deploy vẫn
 * đọc được event do service MỚI phát ra, và ngược lại. Event nằm trong
 * JetStream và được replay, nên cả hai chiều đều có thật.
 */
export function checkBackwardCompatible(
  published: SchemaShape,
  current: SchemaShape,
): CompatReport {
  const breaking: string[] = [];
  const risky: string[] = [];
  const additive: string[] = [];

  for (const [path, before] of Object.entries(published)) {
    const after = current[path];

    if (!after) {
      // Consumer cũ vẫn đọc field này -> mất field là chết ngay
      breaking.push(`${path}: đã bị xoá`);
      continue;
    }

    if (before.type !== after.type) {
      breaking.push(`${path}: kiểu đổi từ ${before.type} sang ${after.type}`);
    }

    if (before.optional && !after.optional) {
      breaking.push(`${path}: từ tuỳ chọn thành BẮT BUỘC — producer cũ không gửi field này`);
    }

    if (!before.optional && after.optional) {
      // Không chết ngay vì producer có thể vẫn luôn gửi. Chết vào ngày
      // đầu tiên nó bỏ gửi, trong khi consumer cũ vẫn bắt buộc có.
      risky.push(`${path}: từ bắt buộc thành tuỳ chọn — consumer cũ vẫn đang bắt buộc`);
    }

    if (!before.nullable && after.nullable) {
      risky.push(`${path}: giờ cho phép null — consumer cũ không xử lý null`);
    }

    if (before.values && after.values) {
      const added = after.values.filter((v) => !before.values!.includes(v));
      const removed = before.values.filter((v) => !after.values!.includes(v));

      // Zod enum từ chối giá trị lạ, nên THÊM giá trị cũng phá tương thích:
      // consumer cũ gặp giá trị mới sẽ ném lỗi và event rơi vào DLQ.
      if (added.length) risky.push(`${path}: thêm giá trị enum [${added.join(', ')}]`);
      if (removed.length) breaking.push(`${path}: bỏ giá trị enum [${removed.join(', ')}]`);
    }
  }

  for (const [path, after] of Object.entries(current)) {
    if (published[path]) continue;

    if (after.optional) {
      additive.push(`${path}: field tuỳ chọn mới`);
    } else {
      breaking.push(`${path}: field BẮT BUỘC mới — consumer cũ không gửi/không hiểu`);
    }
  }

  return {
    compatible: breaking.length === 0 && risky.length === 0,
    breaking,
    risky,
    additive,
  };
}
