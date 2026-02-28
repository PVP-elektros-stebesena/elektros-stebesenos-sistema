import { describe, it, expect } from 'vitest';
import { WindowManager } from '../windowManager.js';
import type { VoltageReading } from '../voltageAnalysis.js';

describe('WindowManager', () => {
  it('buffers readings within the same window', () => {
    const wm = new WindowManager(10);
    const t0 = new Date('2025-01-15T14:30:00Z');
    const t1 = new Date('2025-01-15T14:30:10Z');

    const r0 = wm.addReading({ timestamp: t0, voltage_l1: 230, voltage_l2: 230, voltage_l3: 230 });
    const r1 = wm.addReading({ timestamp: t1, voltage_l1: 231, voltage_l2: 231, voltage_l3: 231 });

    expect(r0).toBeNull();
    expect(r1).toBeNull();
    expect(wm.bufferSize).toBe(2);
  });

  it('emits completed window when a new window starts', () => {
    const wm = new WindowManager(10);

    // Readings in the 14:30 window
    for (let i = 0; i < 60; i++) {
      const t = new Date('2025-01-15T14:30:00Z');
      t.setSeconds(t.getSeconds() + i * 10);
      wm.addReading({ timestamp: t, voltage_l1: 230, voltage_l2: 230, voltage_l3: 230 });
    }

    // First reading in the 14:40 window triggers completion
    const result = wm.addReading({
      timestamp: new Date('2025-01-15T14:40:00Z'),
      voltage_l1: 230,
      voltage_l2: 230,
      voltage_l3: 230,
    });

    expect(result).not.toBeNull();
    expect(result!.sampleCount).toBe(60);
    expect(result!.compliantL1).toBe(true);
    expect(wm.bufferSize).toBe(1); // new window has 1 reading
  });

  it('flush() returns the current buffered window', () => {
    const wm = new WindowManager(10);

    wm.addReading({
      timestamp: new Date('2025-01-15T14:30:05Z'),
      voltage_l1: 230,
      voltage_l2: 230,
      voltage_l3: 230,
    });

    const result = wm.flush();
    expect(result).not.toBeNull();
    expect(result!.sampleCount).toBe(1);
    expect(wm.bufferSize).toBe(0);
  });
});