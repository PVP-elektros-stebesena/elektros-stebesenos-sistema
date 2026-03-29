import type { EffectivePowerPolicy } from '../config/powerPolicy.js';
import {
  aggregatePowerWindow,
  type PowerReading,
  type PowerWindowResult,
} from './powerAnalysis.js';
import { getWindowStart } from './voltageAnalysis.js';

export class PowerWindowManager {
  private currentWindowStart: Date | null = null;
  private buffer: PowerReading[] = [];

  addReading(
    reading: PowerReading,
    policy: EffectivePowerPolicy,
  ): PowerWindowResult | null {
    const windowStart = getWindowStart(reading.timestamp);
    let completedWindow: PowerWindowResult | null = null;

    if (this.currentWindowStart === null) {
      this.currentWindowStart = windowStart;
      this.buffer = [reading];
      return null;
    }

    if (windowStart.getTime() !== this.currentWindowStart.getTime()) {
      completedWindow = aggregatePowerWindow(this.buffer, this.currentWindowStart, policy);
      this.currentWindowStart = windowStart;
      this.buffer = [reading];
    } else {
      this.buffer.push(reading);
    }

    return completedWindow;
  }

  flush(policy: EffectivePowerPolicy): PowerWindowResult | null {
    if (this.currentWindowStart === null || this.buffer.length === 0) {
      return null;
    }

    const result = aggregatePowerWindow(this.buffer, this.currentWindowStart, policy);
    this.currentWindowStart = null;
    this.buffer = [];
    return result;
  }
}
