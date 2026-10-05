import type { z } from 'zod';
import { pingEchoCreatedV1 } from './ping';
import {
  passwordResetRequestedV1,
  profileCreatedV1,
  profileDeletedV1,
  securityAlertV1,
  userLoggedInV1,
  userRegisteredV1,
  userVerifiedV1,
} from './identity';

export * from './ping';
export * from './identity';

/**
 * Nguồn sự thật duy nhất cho mọi event trong hệ thống.
 *
 * Producer và consumer đều lấy schema từ đây, nên không thể lệch nhau mà
 * TypeScript không báo. Thêm event mới = thêm một dòng ở đây + contract test.
 *
 * Checklist khi thêm event: xem docs/14-inter-service-communication.md §9
 */
export const EVENT_REGISTRY = {
  'ping.echo.created': { version: 1, schema: pingEchoCreatedV1 },

  'identity.user.registered': { version: 1, schema: userRegisteredV1 },
  'identity.user.verified': { version: 1, schema: userVerifiedV1 },
  'identity.user.logged_in': { version: 1, schema: userLoggedInV1 },
  'identity.security.alert': { version: 1, schema: securityAlertV1 },
  'identity.profile.created': { version: 1, schema: profileCreatedV1 },
  'identity.profile.deleted': { version: 1, schema: profileDeletedV1 },
  'identity.password.reset_requested': { version: 1, schema: passwordResetRequestedV1 },
} as const;

export type EventRegistry = typeof EVENT_REGISTRY;
export type EventType = keyof EventRegistry;

/** Kiểu payload của một event, suy ra từ registry */
export type EventData<T extends EventType> = z.infer<EventRegistry[T]['schema']>;

export const ALL_EVENT_TYPES = Object.keys(EVENT_REGISTRY) as EventType[];

export function isKnownEventType(type: string): type is EventType {
  return type in EVENT_REGISTRY;
}

/**
 * Parse + validate payload của một event.
 * Ném ZodError nếu không khớp hợp đồng.
 */
export function parseEventData<T extends EventType>(type: T, data: unknown): EventData<T> {
  return EVENT_REGISTRY[type].schema.parse(data);
}

export function eventVersion<T extends EventType>(type: T): number {
  return EVENT_REGISTRY[type].version;
}
