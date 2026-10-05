import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { getLogger } from '../observability/logger';

/**
 * Báo động khi Mongoose tạo index THẤT BẠI.
 *
 * Vì sao cần: `autoIndex: true` chạy ngầm và **nuốt lỗi**. Nếu dữ liệu hiện
 * có vi phạm ràng buộc (vd còn document cũ khiến unique index không tạo
 * được), Mongoose bỏ qua và service vẫn khởi động bình thường.
 *
 * Hậu quả rất xấu và rất khó thấy: ứng dụng *tin* rằng có unique index —
 * outbox tin rằng `eventId` không thể trùng — trong khi thực tế index không
 * tồn tại. Hệ thống chạy đúng cho tới ngày có một bản ghi trùng lọt vào.
 *
 * Đây là bug có thật đã gặp ở Phase 0: đổi tên field `id` -> `eventId`,
 * index cũ không bị xoá, document cũ không có field mới, unique index mới
 * im lặng không được tạo.
 */
@Injectable()
export class IndexGuard implements OnApplicationBootstrap {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  onApplicationBootstrap(): void {
    for (const name of this.connection.modelNames()) {
      const model = this.connection.model(name);

      // Mongoose phát sự kiện 'index' sau khi autoIndex chạy xong.
      // err != null nghĩa là CÓ index không tạo được.
      model.on('index', (err: Error | null) => {
        if (!err) return;
        getLogger().error(
          { model: name, err: err.message },
          'TẠO INDEX THẤT BẠI — ràng buộc trong schema KHÔNG được thực thi. ' +
            'Thường do dữ liệu cũ vi phạm ràng buộc mới (vd đổi tên field mà ' +
            'chưa migrate). Phải sửa dữ liệu rồi khởi động lại.',
        );
      });
    }
  }

  /**
   * Đối chiếu index thực tế trong DB với index khai báo trong schema.
   * Trả về danh sách index bị thiếu — rỗng là tốt.
   */
  async findMissingIndexes(): Promise<{ model: string; missing: string[] }[]> {
    const result: { model: string; missing: string[] }[] = [];

    for (const name of this.connection.modelNames()) {
      const model = this.connection.model(name);
      try {
        const existing = (await model.collection.indexes()) as { name?: string }[];
        const existingNames = new Set(existing.map((i) => i.name).filter(Boolean));

        const declared = model.schema.indexes();
        const missing = declared
          .map(([keys]) =>
            Object.entries(keys)
              .map(([k, v]) => `${k}_${String(v)}`)
              .join('_'),
          )
          .filter((n) => !existingNames.has(n));

        if (missing.length) result.push({ model: name, missing });
      } catch {
        // Collection chưa tồn tại — bình thường, MongoDB tạo lười
      }
    }

    return result;
  }
}
