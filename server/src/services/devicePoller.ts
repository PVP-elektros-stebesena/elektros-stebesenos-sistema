import prisma from '../lib/prisma.js';
import { AnomalyRepository } from './anomalyRepository.js';
import type { DeviceRuntime } from './devicePollerTypes.js';
import { type NotificationEventAdapter } from './notificationTypes.js';
import { ReadingPipeline } from './readingPipeline.js';
import { TransportManager } from './transportManager.js';

const NOOP_NOTIFICATION_ADAPTER: NotificationEventAdapter = {
  async notifyAnomalyDetected() {},
  async notifyDeviceUnreachable() {},
  async notifyDeviceRecovered() {},
  async notifyReportGenerated() {},
  async notifyExportOpportunity() {},
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

  /** Transport orchestration for HTTP and MQTT runtimes */
  private transportManager: TransportManager;

  /** Persistence and anomaly/window processing pipeline */
  private readingPipeline: ReadingPipeline;

  /** Anomaly persistence + notification dispatch */
  private anomalyRepository: AnomalyRepository;

  constructor(opts?: {
    syncIntervalMs?: number;
    fetchFn?: typeof fetch;
    notificationAdapter?: NotificationEventAdapter;
  }) {
    this.syncIntervalMs = opts?.syncIntervalMs ?? 3_600_000;
    this.fetchFn = opts?.fetchFn ?? globalThis.fetch;
    this.notificationAdapter = opts?.notificationAdapter ?? NOOP_NOTIFICATION_ADAPTER;

    this.anomalyRepository = new AnomalyRepository(this.notificationAdapter);
    this.readingPipeline = new ReadingPipeline(this.anomalyRepository);
    this.transportManager = new TransportManager(this.fetchFn);
  }

  setNotificationAdapter(adapter: NotificationEventAdapter): void {
    this.notificationAdapter = adapter;
    this.anomalyRepository.setNotificationAdapter(adapter);
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
      await this.stopRuntime(rt);
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

        await this.stopRuntime(existing);

        if (desiredMode === 'mqtt') {
          this.startDeviceMqtt(
            device.id,
            device.mqttBroker!,
            device.mqttPort,
            device.mqttTopic!,
            device.pollInterval,
            existing,
          );
        } else {
          this.startDevicePoller(
            device.id,
            device.deviceIp!,
            device.pollInterval,
            existing,
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
    await this.transportManager.stopRuntime(rt);
    await this.readingPipeline.flushRuntime(rt.deviceId, rt);
  }

  // ── Per-device HTTP runtime ────────────────────────────────────

  private startDevicePoller(
    deviceId: number,
    deviceIp: string,
    pollInterval: number,
    existingRuntime?: DeviceRuntime,
  ): void {
    const runtime = this.transportManager.startHttpRuntime({
      deviceId,
      deviceIp,
      pollInterval,
      processors: existingRuntime
        ? {
            tracker: existingRuntime.tracker,
            windowMgr: existingRuntime.windowMgr,
            powerTracker: existingRuntime.powerTracker,
            powerWindowMgr: existingRuntime.powerWindowMgr,
          }
        : undefined,
      onReading: (id, raw, now, processors) => this.readingPipeline.processIncomingReading(id, raw, now, processors),
      onDeviceUnreachable: (id, endpoint, reason) => this.markDeviceUnreachable(id, endpoint, reason),
      onDeviceRecovered: (id, endpoint) => this.markDeviceRecovered(id, endpoint),
    });

    this.runtimes.set(deviceId, runtime);
  }

  // ── Per-device MQTT runtime ────────────────────────────────────

  private startDeviceMqtt(
    deviceId: number,
    mqttBroker: string,
    mqttPort: number | null,
    mqttTopic: string,
    pollInterval: number,
    existingRuntime?: DeviceRuntime,
  ): void {
    const runtime = this.transportManager.startMqttRuntime({
      deviceId,
      mqttBroker,
      mqttPort,
      mqttTopic,
      pollInterval,
      processors: existingRuntime
        ? {
            tracker: existingRuntime.tracker,
            windowMgr: existingRuntime.windowMgr,
            powerTracker: existingRuntime.powerTracker,
            powerWindowMgr: existingRuntime.powerWindowMgr,
          }
        : undefined,
      onReading: (id, raw, now, processors) => this.readingPipeline.processIncomingReading(id, raw, now, processors),
      onDeviceUnreachable: (id, endpoint, reason) => this.markDeviceUnreachable(id, endpoint, reason),
      onDeviceRecovered: (id, endpoint) => this.markDeviceRecovered(id, endpoint),
    });

    this.runtimes.set(deviceId, runtime);
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
