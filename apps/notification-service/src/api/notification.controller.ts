import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  listNotificationsRequest,
  markReadRequest,
  type ListNotificationsResponse,
  type MarkReadResponse,
} from '@nekoflix/contracts';
import { RpcData } from '@nekoflix/service-kit';
import { Notification } from '../persistence/schemas/notification.schema';

@Controller()
export class NotificationController {
  constructor(
    @InjectModel(Notification.name) private readonly notifications: Model<Notification>,
  ) {}

  @MessagePattern('notification.list')
  async list(@RpcData() raw: unknown): Promise<ListNotificationsResponse> {
    const { userId, unreadOnly, limit } = listNotificationsRequest.parse(raw);

    const filter: Record<string, unknown> = { userId };
    if (unreadOnly) filter.readAt = null;

    const [docs, unread] = await Promise.all([
      this.notifications.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      this.notifications.countDocuments({ userId, readAt: null }),
    ]);

    return {
      items: docs.map((d) => ({
        id: d._id.toString(),
        type: d.type,
        title: d.title,
        body: d.body,
        data: d.data,
        read: d.readAt !== null,
        createdAt: new Date(d.createdAt).toISOString(),
      })),
      unreadCount: unread,
    };
  }

  @MessagePattern('notification.markRead')
  async markRead(@RpcData() raw: unknown): Promise<MarkReadResponse> {
    const { userId, notificationId } = markReadRequest.parse(raw);

    // Luôn kèm userId: thiếu nó, ai biết id là đánh dấu đọc của người khác
    const filter: Record<string, unknown> = { userId, readAt: null };
    if (notificationId) filter._id = notificationId;

    const res = await this.notifications.updateMany(filter, { $set: { readAt: new Date() } });
    return { marked: res.modifiedCount };
  }
}
