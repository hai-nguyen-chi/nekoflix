import type { Db } from 'mongodb';

export interface Seed {
  /** Tên dùng với --only */
  name: string;
  /** Database của service sở hữu, vd 'nekoflix_identity' */
  database: string;
  /** Ghi dữ liệu, trả về số bản ghi đã ghi */
  run(db: Db): Promise<number>;
}

/**
 * Sinh ObjectId TẤT ĐỊNH từ một chuỗi.
 *
 * Đây là mấu chốt làm seed chạy được nhiều lần và trên nhiều máy mà vẫn ra
 * cùng kết quả: `seedId('user:admin')` luôn cho cùng một _id, nên upsert
 * lần hai chỉ cập nhật chứ không tạo bản ghi trùng.
 *
 * Dùng `ObjectId` ngẫu nhiên thì mỗi lần seed lại sinh dữ liệu mới, và hai
 * máy sẽ có id khác nhau — hỏng đúng mục đích của seed.
 */
export function seedId(key: string): import('mongodb').ObjectId {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const { ObjectId } = require('mongodb') as typeof import('mongodb');
  return new ObjectId(createHash('sha256').update(key).digest('hex').slice(0, 24));
}
