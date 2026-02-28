import {
  type VoltageReading,
  type RmsWindowResult,
  getWindowStart,
  aggregateWindow,
} from './voltageAnalysis.js';
import { ESO } from '../config/eso.js';

/**
 * Manages accumulation of readings into 10-minute windows
 * and triggers aggregation when a window closes.
 *
 * No DB dependency, produces RmsWindowResult objects for
 * the persistence layer to store.
 */
export class WindowManager {
  private currentWindowStart: Date | null = null;
  private buffer: VoltageReading[] = [];
  private pollIntervalSeconds: number;

  constructor(pollIntervalSeconds: number = 10) {
    this.pollIntervalSeconds = pollIntervalSeconds;
  }

  /**
   * Add a reading. If it belongs to a new window, the previous
   * window is finalised and returned.
   *
   * @returns The completed RmsWindowResult if a window just closed, else null.
   */
  addReading(reading: VoltageReading): RmsWindowResult | null {
    const windowStart = getWindowStart(reading.timestamp);
    let completedWindow: RmsWindowResult | null = null;

    if (this.currentWindowStart === null) {
      // First ever reading
      this.currentWindowStart = windowStart;
      this.buffer = [reading];
      return null;
    }

    if (windowStart.getTime() !== this.currentWindowStart.getTime()) {
      // New window -> finalise old one
      completedWindow = aggregateWindow(
        this.buffer,
        this.currentWindowStart,
        this.pollIntervalSeconds,
      );

      // Start new window
      this.currentWindowStart = windowStart;
      this.buffer = [reading];
    } else {
      // Same window - accumulate
      this.buffer.push(reading);
    }

    return completedWindow;
  }

  /** Force-close the current window (e.g. on shutdown). */
  flush(): RmsWindowResult | null {
    if (this.currentWindowStart === null || this.buffer.length === 0) {
      return null;
    }

    const result = aggregateWindow(
      this.buffer,
      this.currentWindowStart,
      this.pollIntervalSeconds,
    );

    this.currentWindowStart = null;
    this.buffer = [];
    return result;
  }

  /** Number of readings in the current buffer. */
  get bufferSize(): number {
    return this.buffer.length;
  }
}