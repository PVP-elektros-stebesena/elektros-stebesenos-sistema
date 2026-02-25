import type { DailyPoint, TimeSeriesPoint } from '../types/energy';

export function gen24h(base: number, variance: number): TimeSeriesPoint[] {
  return Array.from({ length: 24 }, (_, i) => ({
    time: `${String(i).padStart(2, '0')}:00`,
    value: +Math.max(0, base + (Math.random() - 0.5) * variance).toFixed(3),
  }));
}

export function gen30days(): DailyPoint[] {
  const days: DailyPoint[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const imp = +(8 + Math.random() * 10).toFixed(2);
    const exp = +(1 + Math.random() * 6).toFixed(2);
    const gas = +(0.5 + Math.random() * 3).toFixed(2);
    days.push({
      date: d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }),
      import: imp,
      export: exp,
      gas,
      cost: +(imp * 0.28 - exp * 0.09 + gas * 0.81).toFixed(2),
    });
  }
  return days;
}

export const POWER_24H = gen24h(1.8, 2.4);
export const RETURN_24H = gen24h(0.4, 0.8);
export const GAS_24H: TimeSeriesPoint[] = Array.from({ length: 24 }, (_, i) => ({
  time: `${String(i).padStart(2, '0')}:00`,
  value: i < 7 || i > 21
    ? +Math.max(0, 0.06 + (Math.random() - 0.5) * 0.08).toFixed(3)
    : +Math.max(0, 0.01 + (Math.random() - 0.5) * 0.02).toFixed(3),
}));
export const DAYS_30 = gen30days();