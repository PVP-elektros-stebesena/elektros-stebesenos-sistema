import prisma from '../lib/prisma.js';
import type { AnomalySummaryRow } from './reportGenerator.js';

export interface DailyReportMetric {
  date: string;
  energyConsumedKwh: number;
  energyReturnedKwh: number;
  efficiencyPct: number | null;
  avgHourlyElectricityKwh: number;
  sampleCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
  isPartialDay: boolean;
}

export interface HourlyReportMetric {
  timestamp: string;
  energyConsumedKwh: number;
  energyReturnedKwh: number;
  efficiencyPct: number | null;
  avgHourlyElectricityKwh: number;
}

export interface AnomalyTypeDistributionItem {
  type: string;
  count: number;
}

export interface AnomalyAppendixItem {
  type: string;
  description: string;
}

export interface ReportInsights {
  totalEnergyConsumedKwh: number;
  totalEnergyReturnedKwh: number;
  averageEfficiencyPct: number | null;
  averageHourlyElectricityKwh: number | null;
  daily: DailyReportMetric[];
  hourly: HourlyReportMetric[];
  anomalyTypeDistribution: AnomalyTypeDistributionItem[];
  narrative: string;
  anomalyAppendix: AnomalyAppendixItem[];
}

interface ReadingPoint {
  timestamp: Date;
  energyDelivered: number | null;
  energyReturned: number | null;
}

const ANOMALY_TYPE_EXPLANATIONS: Record<string, string> = {
  LONG_INTERRUPTION:
    'Extended power interruption, typically indicating a significant supply disturbance that requires technical follow-up.',
  SHORT_INTERRUPTION:
    'Short power interruption, commonly associated with switching operations or short transient disturbances.',
  OVER_VOLTAGE:
    'Voltage exceeded permitted limits; prolonged exposure may increase equipment stress and reduce component lifetime.',
  UNDER_VOLTAGE:
    'Voltage dropped below permitted limits; this can result in unstable operation of connected electrical loads.',
  VOLTAGE_DEVIATION:
    'Voltage deviated from nominal operating range; trend monitoring is recommended to assess recurrence and duration.',
};

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function safeDelta(start: number | null, end: number | null): number {
  if (start == null || end == null) return 0;
  if (end < start) return 0;
  return +(end - start).toFixed(3);
}

function buildNarrative(
  totalEnergyConsumedKwh: number,
  averageEfficiencyPct: number | null,
  anomalyTypeDistribution: AnomalyTypeDistributionItem[],
  daily: DailyReportMetric[],
): string {
  const hasAnomalies = anomalyTypeDistribution.length > 0;
  const topAnomaly = hasAnomalies
    ? anomalyTypeDistribution.reduce((acc, cur) => (cur.count > acc.count ? cur : acc))
    : null;

  const maxConsumptionDay = daily.length > 0
    ? daily.reduce((acc, cur) => (cur.energyConsumedKwh > acc.energyConsumedKwh ? cur : acc))
    : null;

  const parts: string[] = [];

  parts.push(`During the selected period, total imported electricity was ${totalEnergyConsumedKwh.toFixed(2)} kWh.`);

  if (averageEfficiencyPct != null) {
    parts.push(`The average self-consumption efficiency ratio (imported / (imported + returned)) was ${averageEfficiencyPct.toFixed(1)}%.`);
  } else {
    parts.push('The efficiency ratio could not be computed due to insufficient returned-energy signal in the selected range.');
  }

  if (maxConsumptionDay) {
    parts.push(`Peak daily import occurred on ${maxConsumptionDay.date} with ${maxConsumptionDay.energyConsumedKwh.toFixed(2)} kWh.`);
  }

  if (topAnomaly) {
    parts.push(`The most frequently observed anomaly category was ${topAnomaly.type} (${topAnomaly.count} occurrences).`);
  } else {
    parts.push('No transmission anomalies were detected within the selected reporting interval.');
  }

  return parts.join(' ');
}

function buildDailyMetrics(readings: ReadingPoint[]): DailyReportMetric[] {
  const byDay = new Map<string, ReadingPoint[]>();

  for (const reading of readings) {
    const dayKey = toDayKey(reading.timestamp);
    const bucket = byDay.get(dayKey) ?? [];
    bucket.push(reading);
    byDay.set(dayKey, bucket);
  }

  const metrics: DailyReportMetric[] = [];

  for (const [date, points] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = points[0];
    const last = points[points.length - 1];

    const energyConsumedKwh = safeDelta(first.energyDelivered, last.energyDelivered);
    const energyReturnedKwh = safeDelta(first.energyReturned, last.energyReturned);
    const denom = energyConsumedKwh + energyReturnedKwh;
    const observedHours = Math.max(
      1,
      (last.timestamp.getTime() - first.timestamp.getTime()) / 3600_000,
    );
    const isPartialDay = observedHours < 20;

    metrics.push({
      date,
      energyConsumedKwh,
      energyReturnedKwh,
      // Ignore near-zero days to avoid misleading 100% artifacts at period boundaries
      efficiencyPct: denom >= 0.1 ? +((energyConsumedKwh / denom) * 100).toFixed(2) : null,
      avgHourlyElectricityKwh: +(energyConsumedKwh / (isPartialDay ? observedHours : 24)).toFixed(3),
      sampleCount: points.length,
      firstTimestamp: first.timestamp.toISOString(),
      lastTimestamp: last.timestamp.toISOString(),
      isPartialDay,
    });
  }

  return metrics;
}

function toHourKey(date: Date): string {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function buildHourlyMetrics(readings: ReadingPoint[]): HourlyReportMetric[] {
  const byHour = new Map<string, { consumed: number; returned: number }>();

  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const curr = readings[i];

    const consumedDelta = safeDelta(prev.energyDelivered, curr.energyDelivered);
    const returnedDelta = safeDelta(prev.energyReturned, curr.energyReturned);
    const hourKey = toHourKey(curr.timestamp);

    const existing = byHour.get(hourKey) ?? { consumed: 0, returned: 0 };
    existing.consumed += consumedDelta;
    existing.returned += returnedDelta;
    byHour.set(hourKey, existing);
  }

  return [...byHour.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, totals]) => {
      const energyConsumedKwh = +totals.consumed.toFixed(3);
      const energyReturnedKwh = +totals.returned.toFixed(3);
      const denom = energyConsumedKwh + energyReturnedKwh;

      // Compute efficiency for hours with meaningful denom
      // This avoids flattening the chart at zero when nothing happens
      const hourlyEfficiencyPct =
        denom >= 0.1
          ? +((energyConsumedKwh / denom) * 100).toFixed(2)
          : null;

      return {
        timestamp,
        energyConsumedKwh,
        energyReturnedKwh,
        efficiencyPct: hourlyEfficiencyPct,
        avgHourlyElectricityKwh: +energyConsumedKwh.toFixed(3),
      };
    });
}

export async function buildReportInsights(
  deviceId: number,
  startsAt: Date,
  endsAt: Date,
  anomalies: AnomalySummaryRow[],
): Promise<ReportInsights> {
  const readings = await prisma.reading.findMany({
    where: {
      deviceId,
      timestamp: { gte: startsAt, lte: endsAt },
    },
    orderBy: { timestamp: 'asc' },
    select: {
      timestamp: true,
      energyDelivered: true,
      energyReturned: true,
    },
  });

  const daily = buildDailyMetrics(readings);
  const hourly = buildHourlyMetrics(readings);

  const totalEnergyConsumedKwh = +daily
    .reduce((sum, day) => sum + day.energyConsumedKwh, 0)
    .toFixed(3);

  const totalEnergyReturnedKwh = +daily
    .reduce((sum, day) => sum + day.energyReturnedKwh, 0)
    .toFixed(3);

  const efficiencyValues = daily
    .map((day) => day.efficiencyPct)
    .filter((val): val is number => val != null);

  const averageEfficiencyPct = efficiencyValues.length > 0
    ? +(efficiencyValues.reduce((sum, val) => sum + val, 0) / efficiencyValues.length).toFixed(2)
    : null;

  const averageHourlyElectricityKwh = daily.length > 0
    ? +(daily.reduce((sum, day) => sum + day.avgHourlyElectricityKwh, 0) / daily.length).toFixed(3)
    : null;

  const distributionMap = new Map<string, number>();
  for (const anomaly of anomalies) {
    distributionMap.set(anomaly.type, (distributionMap.get(anomaly.type) ?? 0) + 1);
  }

  const anomalyTypeDistribution = [...distributionMap.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const anomalyAppendix: AnomalyAppendixItem[] = anomalyTypeDistribution.map((item) => ({
    type: item.type,
    description: ANOMALY_TYPE_EXPLANATIONS[item.type] ?? 'An anomaly type was detected, but a formal description is not available yet.',
  }));

  const narrative = buildNarrative(
    totalEnergyConsumedKwh,
    averageEfficiencyPct,
    anomalyTypeDistribution,
    daily,
  );

  return {
    totalEnergyConsumedKwh,
    totalEnergyReturnedKwh,
    averageEfficiencyPct,
    averageHourlyElectricityKwh,
    daily,
    hourly,
    anomalyTypeDistribution,
    narrative,
    anomalyAppendix,
  };
}
