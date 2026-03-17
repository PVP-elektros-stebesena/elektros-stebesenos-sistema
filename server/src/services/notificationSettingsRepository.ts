import prisma from '../lib/prisma.js';
import type { NotificationEventType } from './notificationTypes.js';

export interface NotificationEventSetting {
  eventType: NotificationEventType;
  deviceId: number | null;
  enabled: boolean;
  updatedAt: Date;
}

interface RawSettingRow {
  eventType: string;
  deviceId: number | null;
  enabled: boolean;
  updatedAt: Date;
}

function rowToSetting(row: RawSettingRow): NotificationEventSetting {
  return {
    eventType: row.eventType as NotificationEventType,
    deviceId: row.deviceId,
    enabled: row.enabled,
    updatedAt: row.updatedAt,
  };
}

export async function isNotificationEventEnabled(
  eventType: NotificationEventType,
  deviceId?: number,
): Promise<boolean> {
  if (deviceId != null) {
    const perDeviceRow = await prisma.notificationEventToggle.findFirst({
      where: { eventType, deviceId },
      select: { eventType: true, deviceId: true, enabled: true, updatedAt: true },
    });

    if (perDeviceRow) {
      return perDeviceRow.enabled;
    }
  }

  const globalRow = await prisma.notificationEventToggle.findFirst({
    where: { eventType, deviceId: null },
    select: { eventType: true, deviceId: true, enabled: true, updatedAt: true },
  });

  if (globalRow) {
    return globalRow.enabled;
  }

  // Default behavior: enabled unless explicitly disabled.
  return true;
}

export async function listNotificationSettings(deviceId?: number): Promise<NotificationEventSetting[]> {
  if (deviceId != null) {
    const rows: RawSettingRow[] = await prisma.notificationEventToggle.findMany({
      where: {
        OR: [{ deviceId }, { deviceId: null }],
      },
      orderBy: [{ eventType: 'asc' }, { deviceId: 'asc' }],
      select: { eventType: true, deviceId: true, enabled: true, updatedAt: true },
    });
    return rows.map(rowToSetting);
  }

  const rows: RawSettingRow[] = await prisma.notificationEventToggle.findMany({
    orderBy: [{ eventType: 'asc' }, { deviceId: 'asc' }],
    select: { eventType: true, deviceId: true, enabled: true, updatedAt: true },
  });

  return rows.map(rowToSetting);
}

export async function setNotificationSetting(input: {
  eventType: NotificationEventType;
  enabled: boolean;
  deviceId?: number | null;
}): Promise<NotificationEventSetting> {
  const deviceId = input.deviceId ?? null;

  if (deviceId === null) {
    const existing = await prisma.notificationEventToggle.findFirst({
      where: { eventType: input.eventType, deviceId: null },
    });

    const row = existing
      ? await prisma.notificationEventToggle.update({
          where: { id: existing.id },
          data: { enabled: input.enabled },
        })
      : await prisma.notificationEventToggle.create({
          data: {
            eventType: input.eventType,
            deviceId: null,
            enabled: input.enabled,
          },
        });

    return rowToSetting(row);
  }

  const row = await prisma.notificationEventToggle.upsert({
    where: {
      eventType_deviceId: {
        eventType: input.eventType,
        deviceId,
      },
    },
    update: {
      enabled: input.enabled,
    },
    create: {
      eventType: input.eventType,
      deviceId,
      enabled: input.enabled,
    },
  });

  return rowToSetting(row);
}
