/**
 * Device Poller Service
 *
 * Polls every active device's P1 gateway at its configured interval.
 * On each reading it:
 *   1. Persists the full Reading row to DB
 *   2. Feeds the voltage data through AnomalyTracker → persists anomalies
 *   3. Feeds the voltage data through WindowManager → persists aggregated windows
 *
 * Re-syncs the device list from the database every hour so newly
 * added / removed / deactivated devices are picked up without restart.
 */

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
  deviceIp: string;
  pollInterval: number;
  tracker: AnomalyTracker;
  windowMgr: WindowManager;
  timer: ReturnType<typeof setInterval>;
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
    this.syncIntervalMs = opts?.syncIntervalMs ?? 3_600_000; // 1 h
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

    console.log('[DevicePoller] Running. Next device-list sync in %d min.',
      Math.round(this.syncIntervalMs / 60_000));
  }

  /** Gracefully stop all polling timers. */
  async stop(): Promise<void> {
    console.log('[DevicePoller] Stopping…');

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Flush every window manager and stop timers
    for (const rt of this.runtimes.values()) {
      clearInterval(rt.timer);
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
   * Fetch all active devices from DB and reconcile with running timers.
   * - New devices → start polling
   * - Removed / deactivated devices → stop polling
   * - Changed pollInterval or IP → restart that device's timer
   *
   * Called automatically on an hourly interval, but can also be
   * triggered manually (e.g. after a device is added/updated/deleted).
   */
  async syncDevices(): Promise<void> {
    const devices = await prisma.device.findMany({
      where: { isActive: true, deviceIp: { not: null } },
    });

    const activeIds = new Set(devices.map((d) => d.id));

    // Stop polling for devices that are no longer active / present
    for (const [id, rt] of this.runtimes) {
      if (!activeIds.has(id)) {
        console.log('[DevicePoller] Removing device %d', id);
        clearInterval(rt.timer);
        const flushed = rt.windowMgr.flush();
        if (flushed) {
          await this.saveAggregatedWindow(id, flushed);
        }
        this.runtimes.delete(id);
        this.connectivityState.delete(id);
      }
    }

    // Start or update polling for each active device
    for (const device of devices) {
      if (!device.deviceIp) continue;

      const existing = this.runtimes.get(device.id);

      if (existing) {
        // Check if config changed
        const ipChanged = existing.deviceIp !== device.deviceIp;
        const intervalChanged = existing.pollInterval !== device.pollInterval;

        if (!ipChanged && !intervalChanged) continue; // nothing to do

        // Config changed → restart this device's poller
        console.log('[DevicePoller] Restarting device %d (config changed)', device.id);
        clearInterval(existing.timer);
        // Keep tracker/windowMgr state to preserve anomaly continuity
        this.startDevicePoller(
          device.id,
          device.deviceIp,
          device.pollInterval,
          existing.tracker,
          existing.windowMgr,
        );
      } else {
        // Brand-new device
        console.log('[DevicePoller] Starting device %d → %s every %ds',
          device.id, device.deviceIp, device.pollInterval);
        this.startDevicePoller(
          device.id,
          device.deviceIp,
          device.pollInterval,
        );
      }
    }

    console.log('[DevicePoller] Synced — %d device(s) polling.', this.runtimes.size);
  }

  // ── Per-device timer ───────────────────────────────────────────

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

    // Also do an immediate first poll
    this.pollDevice(deviceId, deviceIp, t, w).catch((err) =>
      console.error(`[DevicePoller] Device ${deviceId} initial poll error:`, err),
    );

    this.runtimes.set(deviceId, {
      deviceId,
      deviceIp,
      pollInterval,
      tracker: t,
      windowMgr: w,
      timer,
    });
  }

  // ── Single poll cycle ──────────────────────────────────────────

  private async pollDevice(
    deviceId: number,
    deviceIp: string,
    tracker: AnomalyTracker,
    windowMgr: WindowManager,
  ): Promise<void> {
    // 1. Fetch from gateway
    let response: Response;
    try {
      response = await this.fetchFn(deviceIp, {
        signal: AbortSignal.timeout(5_000), // 5s timeout
      });
    } catch (err) {
      await this.markDeviceUnreachable(deviceId, deviceIp, err instanceof Error ? err.message : 'Fetch failed');
      return;
    }

    if (!response.ok) {
      console.warn('[DevicePoller] Device %d HTTP %d', deviceId, response.status);
      await this.markDeviceUnreachable(deviceId, deviceIp, `HTTP ${response.status}`);
      return;
    }

    await this.markDeviceRecovered(deviceId, deviceIp);

    const raw: Record<string, string> = await response.json();
    const now = new Date();

    // 2. Parse full P1 response
    const p1Data = parseP1Response(raw);

    // 3. Save full reading to DB
    await prisma.reading.create({
      data: {
        deviceId,
        timestamp: now,
        ...p1Data,
      },
    });

    // 4. Build voltage reading for analysis pipeline
    const voltageReading = toVoltageReading(p1Data, now);

    // 5. Anomaly detection
    const anomalies = tracker.processReading(voltageReading);
    if (anomalies.length > 0) {
      await this.saveAnomalies(deviceId, anomalies);
    }

    // 6. Window aggregation
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

  private async markDeviceUnreachable(deviceId: number, deviceIp: string, reason: string): Promise<void> {
    const current = this.connectivityState.get(deviceId);
    if (current?.unreachable) return;

    this.connectivityState.set(deviceId, { unreachable: true });
    await this.notificationAdapter.notifyDeviceUnreachable({
      deviceId,
      deviceIp,
      reason,
      at: new Date(),
    });
  }

  private async markDeviceRecovered(deviceId: number, deviceIp: string): Promise<void> {
    const current = this.connectivityState.get(deviceId);
    if (current?.unreachable) {
      await this.notificationAdapter.notifyDeviceRecovered({
        deviceId,
        deviceIp,
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

  /** Which devices are currently being polled */
  getStatus(): { deviceId: number; deviceIp: string; pollInterval: number }[] {
    return [...this.runtimes.values()].map((rt) => ({
      deviceId: rt.deviceId,
      deviceIp: rt.deviceIp,
      pollInterval: rt.pollInterval,
    }));
  }
}

/** Singleton instance */
export const devicePoller = new DevicePoller();
