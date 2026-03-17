import {
  type NotificationEventAdapter,
  type NotificationMessage,
  type NotificationSender,
  type NotificationSeverity,
} from './notificationTypes.js';
import { isNotificationEventEnabled } from './notificationSettingsRepository.js';

const SEVERITY_LABEL: Record<number, NotificationSeverity> = {
  1: 'WARNING',
  2: 'CRITICAL',
};

function formatSeverity(severity: number): string {
  return severity >= 2 ? 'CRITICAL' : 'WARNING';
}

export class NotificationService implements NotificationEventAdapter {
  private senders: NotificationSender[];

  constructor(opts?: { senders?: NotificationSender[] }) {
    this.senders = opts?.senders ?? [];
  }

  addSender(sender: NotificationSender): void {
    this.senders.push(sender);
  }

  private async dispatchIfEnabled(message: NotificationMessage): Promise<void> {
    const enabled = await isNotificationEventEnabled(message.eventType, message.deviceId);
    if (!enabled) return;

    for (const sender of this.senders) {
      try {
        await sender.send(message);
      } catch (err) {
        console.error('[NotificationService] Sender failed:', err);
      }
    }
  }

  async notifyAnomalyDetected(input: {
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
  }): Promise<void> {
    const sev = SEVERITY_LABEL[input.anomaly.severity] ?? 'WARNING';

    await this.dispatchIfEnabled({
      eventType: 'ANOMALY_DETECTED',
      severity: sev,
      occurredAt: input.anomaly.endsAt ?? input.anomaly.startsAt,
      deviceId: input.deviceId,
      title: `Anomaly detected: ${input.anomaly.type}`,
      body: `Device ${input.deviceId}, phase ${input.anomaly.phase}, severity ${formatSeverity(input.anomaly.severity)}`,
      metadata: {
        anomalyId: input.anomaly.id,
        type: input.anomaly.type,
        phase: input.anomaly.phase,
        startsAt: input.anomaly.startsAt.toISOString(),
        endsAt: input.anomaly.endsAt?.toISOString() ?? null,
        durationSeconds: input.anomaly.durationSeconds,
        minVoltage: input.anomaly.minVoltage,
        maxVoltage: input.anomaly.maxVoltage,
      },
    });
  }

  async notifyDeviceUnreachable(input: {
    deviceId: number;
    deviceIp: string;
    reason: string;
    at: Date;
  }): Promise<void> {
    await this.dispatchIfEnabled({
      eventType: 'DEVICE_UNREACHABLE',
      severity: 'CRITICAL',
      occurredAt: input.at,
      deviceId: input.deviceId,
      title: 'Device unreachable',
      body: `Device ${input.deviceId} (${input.deviceIp}) became unreachable: ${input.reason}`,
      metadata: {
        deviceIp: input.deviceIp,
        reason: input.reason,
      },
    });
  }

  async notifyDeviceRecovered(input: {
    deviceId: number;
    deviceIp: string;
    at: Date;
  }): Promise<void> {
    await this.dispatchIfEnabled({
      eventType: 'DEVICE_RECOVERED',
      severity: 'INFO',
      occurredAt: input.at,
      deviceId: input.deviceId,
      title: 'Device recovered',
      body: `Device ${input.deviceId} (${input.deviceIp}) is reachable again`,
      metadata: {
        deviceIp: input.deviceIp,
      },
    });
  }

  async notifyReportGenerated(input: {
    deviceId: number;
    periodType: string;
    startsAt: Date;
    endsAt: Date;
    healthScore: string;
    totalAnomalies: number;
  }): Promise<void> {
    await this.dispatchIfEnabled({
      eventType: 'REPORT_GENERATED',
      severity: 'INFO',
      occurredAt: new Date(),
      deviceId: input.deviceId,
      title: `${input.periodType} report generated`,
      body: `Device ${input.deviceId}: health=${input.healthScore}, anomalies=${input.totalAnomalies}`,
      metadata: {
        periodType: input.periodType,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        healthScore: input.healthScore,
        totalAnomalies: input.totalAnomalies,
      },
    });
  }
}

export class ConsoleNotificationSender implements NotificationSender {
  async send(message: NotificationMessage): Promise<void> {
    console.log(
      '[Notification][%s][%s] %s | %s',
      message.eventType,
      message.severity,
      message.title,
      message.body,
    );
  }
}

export const notificationService = new NotificationService();
