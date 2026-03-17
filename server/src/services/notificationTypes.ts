export const NOTIFICATION_EVENT_TYPES = [
  'ANOMALY_DETECTED',
  'DEVICE_UNREACHABLE',
  'DEVICE_RECOVERED',
  'REPORT_GENERATED',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export type NotificationSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface NotificationMessage {
  eventType: NotificationEventType;
  severity: NotificationSeverity;
  occurredAt: Date;
  deviceId?: number;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationSender {
  send(message: NotificationMessage): Promise<void>;
}

export interface NotificationEventAdapter {
  notifyAnomalyDetected(input: {
    deviceId: number;
    anomaly: {
      id?: number;
      type: string;
      phase: string;
      severity: number;
      startsAt: Date;
      endsAt: Date | null;
      minVoltage: number | null;
      maxVoltage: number | null;
      durationSeconds: number | null;
    };
  }): Promise<void>;

  notifyDeviceUnreachable(input: {
    deviceId: number;
    deviceIp: string;
    reason: string;
    at: Date;
  }): Promise<void>;

  notifyDeviceRecovered(input: {
    deviceId: number;
    deviceIp: string;
    at: Date;
  }): Promise<void>;

  notifyReportGenerated(input: {
    deviceId: number;
    periodType: string;
    startsAt: Date;
    endsAt: Date;
    healthScore: string;
    totalAnomalies: number;
  }): Promise<void>;
}
