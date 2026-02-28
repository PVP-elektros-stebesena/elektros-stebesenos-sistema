import { AnomalyTracker } from './anomalyTracker.js';
import { WindowManager } from './windowManager.js';
import type {
  VoltageReading,
  RmsWindowResult,
  DetectedAnomaly,
  WeeklyComplianceResult,
} from './voltageAnalysis.js';
import { calculateWeeklyCompliance } from './voltageAnalysis.js';

/**
 * In-memory voltage data store.
 *
 * Holds recent readings, completed windows, and anomalies.
 * This will be replaced by DB queries once Prisma models land.
 */

const MAX_READINGS = 86_400; // ~24h at 1 reading/s, ~10 days at 10s interval
const MAX_WINDOWS = 2_016;   // ~2 weeks of 10-min windows
const MAX_ANOMALIES = 1_000;

class VoltageState {
  readonly tracker = new AnomalyTracker();
  readonly windowManager = new WindowManager(10);

  private _readings: VoltageReading[] = [];
  private _windows: RmsWindowResult[] = [];
  private _anomalies: DetectedAnomaly[] = [];
  private _latest: VoltageReading | null = null;

  /** Reset all state — for testing only */
  reset(): void {
    this._readings = [];
    this._windows = [];
    this._anomalies = [];
    this._latest = null;
    this.tracker.reset();
  }

  /** Push a new reading from the poller. Returns any new anomalies. */
  pushReading(reading: VoltageReading): {
    anomalies: DetectedAnomaly[];
    completedWindow: RmsWindowResult | null;
  } {
    this._latest = reading;

    // Store reading (ring-buffer style)
    this._readings.push(reading);
    if (this._readings.length > MAX_READINGS) {
      this._readings = this._readings.slice(-MAX_READINGS);
    }

    // Detect anomalies
    const anomalies = this.tracker.processReading(reading);
    for (const a of anomalies) {
      this._anomalies.push(a);
    }
    if (this._anomalies.length > MAX_ANOMALIES) {
      this._anomalies = this._anomalies.slice(-MAX_ANOMALIES);
    }

    // Window aggregation
    const completedWindow = this.windowManager.addReading(reading);
    if (completedWindow) {
      this._windows.push(completedWindow);
      if (this._windows.length > MAX_WINDOWS) {
        this._windows = this._windows.slice(-MAX_WINDOWS);
      }
    }

    return { anomalies, completedWindow };
  }

  get latest(): VoltageReading | null {
    return this._latest;
  }

  /** All stored readings, optionally filtered by time range */
  getReadings(from?: Date, to?: Date): VoltageReading[] {
    let result = this._readings;
    if (from) result = result.filter((r) => r.timestamp >= from);
    if (to) result = result.filter((r) => r.timestamp <= to);
    return result;
  }

  /** Get readings downsampled to a target number of points */
  getReadingsDownsampled(from: Date, to: Date, maxPoints: number): VoltageReading[] {
    const filtered = this.getReadings(from, to);
    if (filtered.length <= maxPoints) return filtered;

    // Simple LTTB-like downsampling: take every Nth reading
    const step = filtered.length / maxPoints;
    const result: VoltageReading[] = [];
    for (let i = 0; i < maxPoints; i++) {
      result.push(filtered[Math.floor(i * step)]);
    }
    // Always include the last point
    if (result[result.length - 1] !== filtered[filtered.length - 1]) {
      result.push(filtered[filtered.length - 1]);
    }
    return result;
  }

  /** All completed 10-min windows, optionally filtered */
  getWindows(from?: Date, to?: Date): RmsWindowResult[] {
    let result = this._windows;
    if (from) result = result.filter((w) => w.windowStart >= from);
    if (to) result = result.filter((w) => w.windowEnd <= to);
    return result;
  }

  /** All detected anomalies, optionally filtered */
  getAnomalies(opts?: {
    type?: string;
    phase?: string;
    from?: Date;
    to?: Date;
  }): DetectedAnomaly[] {
    let result = this._anomalies;
    if (opts?.type) result = result.filter((a) => a.type === opts.type);
    if (opts?.phase) result = result.filter((a) => a.phase === opts.phase);
    if (opts?.from) result = result.filter((a) => a.startedAt >= opts.from!);
    if (opts?.to) result = result.filter((a) => a.startedAt <= opts.to!);
    return result;
  }

  /** Weekly compliance for the week containing `date` */
  getWeeklyCompliance(date?: Date): WeeklyComplianceResult {
    const d = date ?? new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(d);
    weekStart.setDate(diff);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600_000);

    const weekWindows = this._windows.filter(
      (w) => w.windowStart >= weekStart && w.windowStart < weekEnd,
    );

    return calculateWeeklyCompliance(weekWindows, weekStart);
  }

  /** Total counts for summary */
  get stats() {
    return {
      totalReadings: this._readings.length,
      totalWindows: this._windows.length,
      totalAnomalies: this._anomalies.length,
      activeAnomalies: this.tracker.getActiveAnomalies().length,
    };
  }
}

/** Singleton import this from routes and from the poller */
export const voltageState = new VoltageState();