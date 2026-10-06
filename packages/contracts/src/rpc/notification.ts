import { z } from 'zod';

export const notificationItem = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.unknown()),
  read: z.boolean(),
  createdAt: z.string().datetime(),
});
export type NotificationItem = z.infer<typeof notificationItem>;

export const listNotificationsRequest = z.object({
  userId: z.string(),
  unreadOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
});

export const listNotificationsResponse = z.object({
  items: z.array(notificationItem),
  unreadCount: z.number().int().nonnegative(),
});
export type ListNotificationsResponse = z.infer<typeof listNotificationsResponse>;

export const markReadRequest = z.object({
  userId: z.string(),
  /** Bỏ trống = đánh dấu đọc TẤT CẢ */
  notificationId: z.string().optional(),
});

export const markReadResponse = z.object({ marked: z.number().int().nonnegative() });
export type MarkReadResponse = z.infer<typeof markReadResponse>;
