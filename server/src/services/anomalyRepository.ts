import prisma from '../lib/prisma.js';
import type { DetectedPowerAnomaly } from './powerTracker.js';
import type { NotificationEventAdapter } from './notificationTypes.js';
import type { DetectedAnomaly } from './voltageAnalysis.js';

const NOOP_NOTIFICATION_ADAPTER: NotificationEventAdapter = {
  async notifyAnomalyDetected() {},
  async notifyDeviceUnreachable() {},
  async notifyDeviceRecovered() {},
  async notifyReportGenerated() {},
};

const SEVERITY_MAP: Record<string, number> = {
  WARNING: 1,
  CRITICAL: 2,
};

export class AnomalyRepository {
  private notificationAdapter: NotificationEventAdapter;

  constructor(notificationAdapter?: NotificationEventAdapter) {
    this.notificationAdapter = notificationAdapter ?? NOOP_NOTIFICATION_ADAPTER;
  }

  setNotificationAdapter(adapter: NotificationEventAdapter): void {
    this.notificationAdapter = adapter;
  }

  async persistVoltageAnomalies(deviceId: number, anomalies: DetectedAnomaly[]): Promise<void> {
    if (anomalies.length === 0) return;

    const creates = anomalies.map((anomaly) => prisma.anomaly.create({
      data: {
        deviceId,
        startsAt: anomaly.startedAt,
        endsAt: anomaly.endedAt,
        phase: anomaly.phase,
        type: anomaly.type,
        severity: SEVERITY_MAP[anomaly.severity] ?? 1,
        minVoltage: anomaly.voltageMin,
        maxVoltage: anomaly.voltageMax,
        metricDomain: 'VOLTAGE',
        metricName: anomaly.type === 'VOLTAGE_DEVIATION' ? 'VOLTAGE_RMS' : 'VOLTAGE_INTERRUPTION',
        thresholdValue: null,
        observedMin: anomaly.voltageMin,
        observedMax: anomaly.voltageMax,
        observedAvg:
          anomaly.voltageMin != null && anomaly.voltageMax != null
            ? (anomaly.voltageMin + anomaly.voltageMax) / 2
            : null,
        unit: 'V',
        duration: anomaly.durationSeconds != null ? Math.round(anomaly.durationSeconds) : null,
        description: `${anomaly.type} on phase ${anomaly.phase}`,
      },
    }));

    const savedAnomalies = await this.executeBatch(creates);

    for (const saved of savedAnomalies) {
      await this.notificationAdapter.notifyAnomalyDetected({
        deviceId,
        anomaly: {
          id: saved.id,
          type: saved.type,
          phase: saved.phase,
          severity: saved.severity,
          startsAt: saved.startsAt,
          endsAt: saved.endsAt,
          minVoltage: saved.minVoltage,
          maxVoltage: saved.maxVoltage,
          durationSeconds: saved.duration,
        },
      });
    }
  }

  async persistPowerAnomalies(deviceId: number, anomalies: DetectedPowerAnomaly[]): Promise<void> {
    if (anomalies.length === 0) return;

    const creates = anomalies.map((anomaly) => {
      const durationSeconds = anomaly.endedAt
        ? Math.max(0, Math.round((anomaly.endedAt.getTime() - anomaly.startedAt.getTime()) / 1000))
        : null;

      return prisma.anomaly.create({
        data: {
          deviceId,
          startsAt: anomaly.startedAt,
          endsAt: anomaly.endedAt,
          phase: anomaly.phase,
          type: anomaly.type,
          severity: SEVERITY_MAP[anomaly.severity] ?? 1,
          minVoltage: null,
          maxVoltage: null,
          metricDomain: 'POWER',
          metricName: anomaly.metricName,
          thresholdValue: anomaly.thresholdValue,
          observedMin: anomaly.observedMin,
          observedMax: anomaly.observedMax,
          observedAvg: anomaly.observedAvg,
          unit: anomaly.unit,
          duration: durationSeconds,
          description: anomaly.description,
        },
      });
    });

    const savedAnomalies = await this.executeBatch(creates);

    for (const saved of savedAnomalies) {
      await this.notificationAdapter.notifyAnomalyDetected({
        deviceId,
        anomaly: {
          id: saved.id,
          type: saved.type,
          phase: saved.phase,
          severity: saved.severity,
          startsAt: saved.startsAt,
          endsAt: saved.endsAt,
          minVoltage: null,
          maxVoltage: null,
          durationSeconds: saved.duration,
        },
      });
    }
  }

  private async executeBatch<T>(operations: Array<Promise<T>>): Promise<T[]> {
    const transaction = (prisma as { $transaction?: (ops: Array<Promise<T>>) => Promise<T[]> }).$transaction;

    if (typeof transaction === 'function') {
      return transaction.call(prisma, operations);
    }

    return Promise.all(operations);
  }
}
