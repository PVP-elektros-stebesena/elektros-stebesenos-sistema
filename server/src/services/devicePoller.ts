/**
 * Device Poller Service
 *
 * Supports two transport modes per active device:
 *   - REST polling (deviceIp)
 *   - MQTT subscription (mqttBroker + mqttTopic)
 *
 * On each reading it:
 *   1. Persists the full Reading row to DB
 *   2. Feeds the voltage data through AnomalyTracker → persists anomalies
 *   3. Feeds the voltage data through WindowManager → persists aggregated windows
 *
 * Re-syncs the device list from the database every hour so newly
 * added / removed / deactivated devices are picked up without restart.
 */

import mqtt, { type MqttClient } from 'mqtt';
import prisma from '../lib/prisma.js';
import { AnomalyTracker } from './anomalyTracker.js';
import { WindowManager } from './windowManager.js';
import { parseP1Response, toVoltageReading } from './p1Parser.js';
import type { DetectedAnomaly, RmsWindowResult } from './voltageAnalysis.js';
import { type NotificationEventAdapter } from './notificationTypes.js';

const NOOP_NOTIFICATION_ADAPTER: NotificationEventAdapter = {
  async notifyAnomalyDetected() {},
  async notifyDeviceUnreachable() {},
  async notifyDeviceRecovered() {},
  async notifyReportGenerated() {},
};

// ── Per-device runtime state ───────────────────────────────────────

interface DeviceRuntime {
  deviceId: number;
  mode: 'http' | 'mqtt';
  deviceIp?: string;
  mqttBroker?: string;
  mqttPort?: number | null;
  mqttTopic?: string;
  pollInterval: number;
  tracker: AnomalyTracker;
  windowMgr: WindowManager;
  timer?: ReturnType<typeof setInterval>;
  mqttClient?: MqttClient;
}

// ── Severity mapping ───────────────────────────────────────────────

const SEVERITY_MAP: Record<string, number> = {
  WARNING: 1,
  CRITICAL: 2,
};

// ── DevicePoller class ─────────────────────────────────────────────

export class DevicePoller {
  /** Active device runtimes keyed by device ID */
  private runtimes = new Map<number, DeviceRuntime>();

  /** Timer that re-syncs the device list from DB */
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  /** How often to re-read the device list (ms). Default: 1 hour */
  private syncIntervalMs: number;

  /** Fetch implementation — injectable for testing */
  private fetchFn: typeof fetch;

  /** Outbound notification adapter */
  private notificationAdapter: NotificationEventAdapter;

  /** Device connectivity status to avoid repeated unreachable notifications */
  private connectivityState = new Map<number, { unreachable: boolean }>();

  constructor(opts?: {
    syncIntervalMs?: number;
    fetchFn?: typeof fetch;
    notificationAdapter?: NotificationEventAdapter;
  }) {
    this.syncIntervalMs = opts?.syncIntervalMs ?? 3_600_000;
    this.fetchFn = opts?.fetchFn ?? globalThis.fetch;
    this.notificationAdapter = opts?.notificationAdapter ?? NOOP_NOTIFICATION_ADAPTER;
  }

  setNotificationAdapter(adapter: NotificationEventAdapter): void {
    this.notificationAdapter = adapter;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /** Start the poller — call once after server boots. */
  async start(): Promise<void> {
    console.log('[DevicePoller] Starting…');
    await this.syncDevices();

    this.syncTimer = setInterval(() => {
      this.syncDevices().catch((err) =>
        console.error('[DevicePoller] Sync error:', err),
      );
    }, this.syncIntervalMs);

    console.log(
      '[DevicePoller] Running. Next device-list sync in %d min.',
      Math.round(this.syncIntervalMs / 60_000),
    );
  }

  /** Gracefully stop all runtimes. */
  async stop(): Promise<void> {
    console.log('[DevicePoller] Stopping…');

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    for (const rt of this.runtimes.values()) {
      if (rt.timer) clearInterval(rt.timer);
      if (rt.mqttClient) rt.mqttClient.end(true);

      const flushed = rt.windowMgr.flush();
      if (flushed) {
        await this.saveAggregatedWindow(rt.deviceId, flushed);
      }
    }

    this.runtimes.clear();
    console.log('[DevicePoller] Stopped.');
  }

  // ── Device sync ────────────────────────────────────────────────

  /**
   * Fetch all active devices from DB and reconcile with running runtimes.
   * Priority:
   *   1. MQTT if mqttBroker + mqttTopic are configured
   *   2. HTTP if deviceIp is configured
   */
  async syncDevices(): Promise<void> {
    const devices = await prisma.device.findMany({
      where: {
        isActive: true,
        OR: [
          { deviceIp: { not: null } },
          {
            AND: [
              { mqttBroker: { not: null } },
              { mqttTopic: { not: null } },
            ],
          },
        ],
      },
    });

    const activeIds = new Set(devices.map((d) => d.id));

    // Remove devices that are no longer active/present
    for (const [id, rt] of this.runtimes) {
      if (!activeIds.has(id)) {
        console.log('[DevicePoller] Removing device %d', id);
        await this.stopRuntime(rt);
        this.runtimes.delete(id);
        this.connectivityState.delete(id);
      }
    }

    // Start or update active devices
    for (const device of devices) {
      const wantsMqtt = !!device.mqttBroker && !!device.mqttTopic;
      const wantsHttp = !!device.deviceIp;
      const desiredMode: 'mqtt' | 'http' | null = wantsMqtt ? 'mqtt' : wantsHttp ? 'http' : null;

      if (!desiredMode) continue;

      const existing = this.runtimes.get(device.id);

      if (existing) {
        const modeChanged = existing.mode !== desiredMode;

        const commonChanged =
          existing.pollInterval !== device.pollInterval;

        const httpChanged =
          desiredMode === 'http' &&
          existing.deviceIp !== device.deviceIp;

        const mqttChanged =
          desiredMode === 'mqtt' &&
          (
            existing.mqttBroker !== device.mqttBroker ||
            existing.mqttPort !== device.mqttPort ||
            existing.mqttTopic !== device.mqttTopic
          );

        if (!modeChanged && !commonChanged && !httpChanged && !mqttChanged) {
          continue;
        }

        console.log('[DevicePoller] Restarting device %d (config changed)', device.id);

        const tracker = existing.tracker;
        const windowMgr = existing.windowMgr;

        await this.stopRuntime(existing);

        if (desiredMode === 'mqtt') {
          this.startDeviceMqtt(
            device.id,
            device.mqttBroker!,
            device.mqttPort,
            device.mqttTopic!,
            device.pollInterval,
            tracker,
            windowMgr,
          );
        } else {
          this.startDevicePoller(
            device.id,
            device.deviceIp!,
            device.pollInterval,
            tracker,
            windowMgr,
          );
        }
      } else {
        if (desiredMode === 'mqtt') {
          console.log(
            '[DevicePoller] Starting device %d → MQTT %s:%s topic=%s',
            device.id,
            device.mqttBroker,
            device.mqttPort ?? 1883,
            device.mqttTopic,
          );

          this.startDeviceMqtt(
            device.id,
            device.mqttBroker!,
            device.mqttPort,
            device.mqttTopic!,
            device.pollInterval,
          );
        } else {
          console.log(
            '[DevicePoller] Starting device %d → %s every %ds',
            device.id,
            device.deviceIp,
            device.pollInterval,
          );

          this.startDevicePoller(
            device.id,
            device.deviceIp!,
            device.pollInterval,
          );
        }
      }
    }

    console.log('[DevicePoller] Synced — %d device(s) active.', this.runtimes.size);
  }

  private async stopRuntime(rt: DeviceRuntime): Promise<void> {
    if (rt.timer) clearInterval(rt.timer);
    if (rt.mqttClient) rt.mqttClient.end(true);

    const flushed = rt.windowMgr.flush();
    if (flushed) {
      await this.saveAggregatedWindow(rt.deviceId, flushed);
    }
  }

  // ── Per-device HTTP runtime ────────────────────────────────────

  private startDevicePoller(
    deviceId: number,
    deviceIp: string,
    pollInterval: number,
    tracker?: AnomalyTracker,
    windowMgr?: WindowManager,
  ): void {
    const t = tracker ?? new AnomalyTracker();
    const w = windowMgr ?? new WindowManager(pollInterval);

    const timer = setInterval(() => {
      this.pollDevice(deviceId, deviceIp, t, w).catch((err) =>
        console.error(`[DevicePoller] Device ${deviceId} poll error:`, err),
      );
    }, pollInterval * 1000);

    this.pollDevice(deviceId, deviceIp, t, w).catch((err) =>
      console.error(`[DevicePoller] Device ${deviceId} initial poll error:`, err),
    );

    this.runtimes.set(deviceId, {
      deviceId,
      mode: 'http',
      deviceIp,
      pollInterval,
      tracker: t,
      windowMgr: w,
      timer,
    });
  }

  // ── Per-device MQTT runtime ────────────────────────────────────

  private startDeviceMqtt(
    deviceId: number,
    mqttBroker: string,
    mqttPort: number | null,
    mqttTopic: string,
    pollInterval: number,
    tracker?: AnomalyTracker,
    windowMgr?: WindowManager,
  ): void {
    const t = tracker ?? new AnomalyTracker();
    const w = windowMgr ?? new WindowManager(pollInterval);

    const brokerUrl = this.buildBrokerUrl(mqttBroker, mqttPort);
    const client = mqtt.connect(brokerUrl);

    client.on('connect', async () => {
      console.log(`[DevicePoller] MQTT connected for device ${deviceId} → ${mqttTopic}`);
      await this.markDeviceRecovered(deviceId, `mqtt:${mqttBroker}`);

      client.subscribe(mqttTopic, (err) => {
        if (err) {
          console.error(`[DevicePoller] MQTT subscribe failed for device ${deviceId}:`, err);
        }
      });
    });

    client.on('message', (topic, payload) => {
      this.handleMqttMessage(deviceId, topic, payload, t, w).catch((err) =>
        console.error(`[DevicePoller] Device ${deviceId} MQTT message error:`, err),
      );
    });

    client.on('error', async (err) => {
      console.error(`[DevicePoller] MQTT error for device ${deviceId}:`, err);
      await this.markDeviceUnreachable(deviceId, `mqtt:${mqttBroker}`, err.message);
    });

    client.on('close', async () => {
      console.warn(`[DevicePoller] MQTT disconnected for device ${deviceId}`);
      await this.markDeviceUnreachable(deviceId, `mqtt:${mqttBroker}`, 'MQTT disconnected');
    });

    this.runtimes.set(deviceId, {
      deviceId,
      mode: 'mqtt',
      mqttBroker,
      mqttPort,
      mqttTopic,
      pollInterval,
      tracker: t,
      windowMgr: w,
      mqttClient: client,
    });
  }

  private buildBrokerUrl(host: string, port?: number | null): string {
    if (host.startsWith('mqtt://') || host.startsWith('mqtts://') || host.startsWith('ws://') || host.startsWith('wss://')) {
      return host;
    }
    return `mqtt://${host}:${port ?? 1883}`;
  }

  // ── Single REST poll cycle ─────────────────────────────────────

  private async pollDevice(
    deviceId: number,
    deviceIp: string,
    tracker: AnomalyTracker,
    windowMgr: WindowManager,
  ): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchFn(deviceIp, {
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      await this.markDeviceUnreachable(
        deviceId,
        deviceIp,
        err instanceof Error ? err.message : 'Fetch failed',
      );
      return;
    }

    if (!response.ok) {
      console.warn('[DevicePoller] Device %d HTTP %d', deviceId, response.status);
      await this.markDeviceUnreachable(deviceId, deviceIp, `HTTP ${response.status}`);
      return;
    }

    await this.markDeviceRecovered(deviceId, deviceIp);

    const raw = await response.json() as Record<string, string>;
    const now = new Date();

    await this.processIncomingReading(deviceId, raw, now, tracker, windowMgr);
  }

  // ── Single MQTT message cycle ──────────────────────────────────

  private async handleMqttMessage(
    deviceId: number,
    _topic: string,
    payload: Buffer,
    tracker: AnomalyTracker,
    windowMgr: WindowManager,
  ): Promise<void> {
    let raw: Record<string, string>;

    try {
      raw = JSON.parse(payload.toString()) as Record<string, string>;
    } catch (err) {
      console.error(`[DevicePoller] Device ${deviceId} received invalid MQTT JSON:`, err);
      return;
    }

    const now = new Date();
    await this.processIncomingReading(deviceId, raw, now, tracker, windowMgr);
  }

  // ── Shared reading pipeline ────────────────────────────────────

  private async processIncomingReading(
    deviceId: number,
    raw: Record<string, string>,
    now: Date,
    tracker: AnomalyTracker,
    windowMgr: WindowManager,
  ): Promise<void> {
    const p1Data = parseP1Response(raw);

    await prisma.reading.create({
      data: {
        deviceId,
        timestamp: now,
        ...p1Data,
      },
    });

    const voltageReading = toVoltageReading(p1Data, now);

    const anomalies = tracker.processReading(voltageReading);
    if (anomalies.length > 0) {
      await this.saveAnomalies(deviceId, anomalies);
    }

    const completedWindow = windowMgr.addReading(voltageReading);
    if (completedWindow) {
      await this.saveAggregatedWindow(deviceId, completedWindow);
    }
  }

  // ── DB persistence helpers ─────────────────────────────────────

  private async saveAnomalies(
    deviceId: number,
    anomalies: DetectedAnomaly[],
  ): Promise<void> {
    for (const a of anomalies) {
      const saved = await prisma.anomaly.create({
        data: {
          deviceId,
          startsAt: a.startedAt,
          endsAt: a.endedAt,
          phase: a.phase,
          type: a.type,
          severity: SEVERITY_MAP[a.severity] ?? 1,
          minVoltage: a.voltageMin,
          maxVoltage: a.voltageMax,
          duration: a.durationSeconds != null ? Math.round(a.durationSeconds) : null,
          description: `${a.type} on phase ${a.phase}`,
        },
      });

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

  private async markDeviceUnreachable(
    deviceId: number,
    endpoint: string,
    reason: string,
  ): Promise<void> {
    const current = this.connectivityState.get(deviceId);
    if (current?.unreachable) return;

    this.connectivityState.set(deviceId, { unreachable: true });

    await this.notificationAdapter.notifyDeviceUnreachable({
      deviceId,
      deviceIp: endpoint,
      reason,
      at: new Date(),
    });
  }

  private async markDeviceRecovered(
    deviceId: number,
    endpoint: string,
  ): Promise<void> {
    const current = this.connectivityState.get(deviceId);

    if (current?.unreachable) {
      await this.notificationAdapter.notifyDeviceRecovered({
        deviceId,
        deviceIp: endpoint,
        at: new Date(),
      });
    }

    this.connectivityState.set(deviceId, { unreachable: false });
  }

  private async saveAggregatedWindow(
    deviceId: number,
    window: RmsWindowResult,
  ): Promise<void> {
    await prisma.aggregatedData.upsert({
      where: {
        deviceId_startsAt_endsAt: {
          deviceId,
          startsAt: window.windowStart,
          endsAt: window.windowEnd,
        },
      },
      update: {
        voltageL1: window.rmsVoltageL1,
        voltageL2: window.rmsVoltageL2,
        voltageL3: window.rmsVoltageL3,
        outOfBoundsSecondsL1: window.outOfBoundsSecondsL1,
        outOfBoundsSecondsL2: window.outOfBoundsSecondsL2,
        outOfBoundsSecondsL3: window.outOfBoundsSecondsL3,
        compliantL1: window.compliantL1,
        compliantL2: window.compliantL2,
        compliantL3: window.compliantL3,
        sampleCount: window.sampleCount,
      },
      create: {
        deviceId,
        startsAt: window.windowStart,
        endsAt: window.windowEnd,
        voltageL1: window.rmsVoltageL1,
        voltageL2: window.rmsVoltageL2,
        voltageL3: window.rmsVoltageL3,
        outOfBoundsSecondsL1: window.outOfBoundsSecondsL1,
        outOfBoundsSecondsL2: window.outOfBoundsSecondsL2,
        outOfBoundsSecondsL3: window.outOfBoundsSecondsL3,
        compliantL1: window.compliantL1,
        compliantL2: window.compliantL2,
        compliantL3: window.compliantL3,
        sampleCount: window.sampleCount,
      },
    });
  }

  // ── Diagnostics ────────────────────────────────────────────────

  getStatus(): Array<{
    deviceId: number;
    mode: 'http' | 'mqtt';
    deviceIp?: string;
    mqttBroker?: string;
    mqttPort?: number | null;
    mqttTopic?: string;
    pollInterval: number;
  }> {
    return [...this.runtimes.values()].map((rt) => ({
      deviceId: rt.deviceId,
      mode: rt.mode,
      deviceIp: rt.deviceIp,
      mqttBroker: rt.mqttBroker,
      mqttPort: rt.mqttPort,
      mqttTopic: rt.mqttTopic,
      pollInterval: rt.pollInterval,
    }));
  }
}

/** Singleton instance */
export const devicePoller = new DevicePoller();