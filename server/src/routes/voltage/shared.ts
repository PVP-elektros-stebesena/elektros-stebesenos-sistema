import type { AnomalyType, Phase } from '../../config/eso.js';

export interface DeviceQuery {
  deviceId?: string;
}

export interface TimeRangeQuery extends DeviceQuery {
  from?: string;
  to?: string;
}

export interface HistoryQuery extends TimeRangeQuery {
  /** Max data points to return (default 500) */
  points?: string;
  /** Aggregation: "raw" | "10min" | "latest" (default "raw") */
  interval?: string;
}

export interface AnomalyQuery extends TimeRangeQuery {
  type?: AnomalyType;
  phase?: Phase;
  limit?: string;
}

export function getWeekBounds(date: Date): { weekStart: Date; weekEnd: Date } {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(date);
  weekStart.setDate(diff);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600_000);
  return { weekStart, weekEnd };
}
