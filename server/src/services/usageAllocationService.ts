import prisma from '../lib/prisma.js';

type ReadingRow = {
  timestamp: Date;
  energyDelivered: number | null;
  energyDeliveredTariff1: number | null;
  energyDeliveredTariff2: number | null;
  energyDeliveredTariff3: number | null;
  energyDeliveredTariff4: number | null;
};

const READING_SELECT = {
  timestamp: true,
  energyDelivered: true,
  energyDeliveredTariff1: true,
  energyDeliveredTariff2: true,
  energyDeliveredTariff3: true,
  energyDeliveredTariff4: true,
} as const;

export interface KwhByTariff {
  t1: number;
  t2: number;
  t3: number;
  t4: number;
}

export interface AllocationPeriodUsage {
  allocationId: number;
  renterId: number;
  renterName: string;
  renterEmail: string | null;
  allocationStartsAt: Date;
  allocationEndsAt: Date | null;
  activeStartsAt: Date;
  activeEndsAt: Date;
  kwhUsed: number;
  kwhByTariff: KwhByTariff;
  coveredMs: number;
  totalMs: number;
}

export interface UnallocatedPeriod {
  startsAt: Date;
  endsAt: Date;
  kwhUsed: number;
  coveredMs: number;
  totalMs: number;
}

export interface UsageAllocationResult {
  deviceId: number;
  periodStartsAt: Date;
  periodEndsAt: Date;
  allocationPeriods: AllocationPeriodUsage[];
  unallocatedPeriods: UnallocatedPeriod[];
  totalKwh: number;
  unallocatedKwh: number;
}

function safeDelta(a: number | null, b: number | null): number {
  if (a == null || b == null || b < a) return 0;
  return +(b - a).toFixed(6);
}

function findReadingAtOrBefore(readings: ReadingRow[], target: Date): ReadingRow | null {
  for (let i = readings.length - 1; i >= 0; i--) {
    if (readings[i]!.timestamp.getTime() <= target.getTime()) return readings[i]!;
  }
  return null;
}

function findReadingAtOrAfter(readings: ReadingRow[], target: Date): ReadingRow | null {
  return readings.find((r) => r.timestamp.getTime() >= target.getTime()) ?? null;
}

function effectiveEnergyDelta(prev: ReadingRow, curr: ReadingRow): number {
  if (prev.energyDelivered != null && curr.energyDelivered != null) {
    return safeDelta(prev.energyDelivered, curr.energyDelivered);
  }
  // Fall back to sum of per-tariff deltas when total is unavailable
  return (
    safeDelta(prev.energyDeliveredTariff1, curr.energyDeliveredTariff1) +
    safeDelta(prev.energyDeliveredTariff2, curr.energyDeliveredTariff2) +
    safeDelta(prev.energyDeliveredTariff3, curr.energyDeliveredTariff3) +
    safeDelta(prev.energyDeliveredTariff4, curr.energyDeliveredTariff4)
  );
}

interface SegmentEnergy {
  kwhUsed: number;
  kwhByTariff: KwhByTariff;
  coveredMs: number;
}

function buildSegmentSequence(
  readings: ReadingRow[],
  segmentStart: Date,
  segmentEnd: Date,
): ReadingRow[] {
  const inRange = readings.filter(
    (r) => r.timestamp.getTime() >= segmentStart.getTime() && r.timestamp.getTime() <= segmentEnd.getTime(),
  );
  const startBoundary = findReadingAtOrBefore(readings, segmentStart);
  const endBoundary = findReadingAtOrAfter(readings, segmentEnd);

  return [startBoundary, ...inRange, endBoundary]
    .filter((r): r is ReadingRow => r != null)
    .filter((r, i, arr) => i === 0 || r.timestamp.getTime() !== arr[i - 1]!.timestamp.getTime());
}

// Any pair implying more than 500 kW average is a meter swap / data discontinuity, not real usage.
// 500 kW * (pairDurationMs / 3_600_000) gives the maximum plausible kWh for that interval.
const MAX_KW = 500;

function calculateKwhInSegment(
  readings: ReadingRow[],
  segmentStart: Date,
  segmentEnd: Date,
): SegmentEnergy {
  const zero: SegmentEnergy = {
    kwhUsed: 0,
    kwhByTariff: { t1: 0, t2: 0, t3: 0, t4: 0 },
    coveredMs: 0,
  };

  const sequence = buildSegmentSequence(readings, segmentStart, segmentEnd);
  if (sequence.length < 2) return zero;

  let kwhUsed = 0;
  let t1 = 0;
  let t2 = 0;
  let t3 = 0;
  let t4 = 0;
  let coveredMs = 0;

  for (let i = 1; i < sequence.length; i++) {
    const prev = sequence[i - 1]!;
    const curr = sequence[i]!;

    const pairStartMs = Math.max(prev.timestamp.getTime(), segmentStart.getTime());
    const pairEndMs = Math.min(curr.timestamp.getTime(), segmentEnd.getTime());
    if (pairEndMs <= pairStartMs) continue;

    const pairDurationMs = curr.timestamp.getTime() - prev.timestamp.getTime();
    if (pairDurationMs <= 0) continue;

    const delta = effectiveEnergyDelta(prev, curr);
    const maxPlausibleKwh = MAX_KW * (pairDurationMs / 3_600_000);
    if (delta > maxPlausibleKwh) continue; // meter swap or reset — skip this pair

    const overlapMs = pairEndMs - pairStartMs;
    const ratio = overlapMs / pairDurationMs;

    kwhUsed += delta * ratio;
    t1 += safeDelta(prev.energyDeliveredTariff1, curr.energyDeliveredTariff1) * ratio;
    t2 += safeDelta(prev.energyDeliveredTariff2, curr.energyDeliveredTariff2) * ratio;
    t3 += safeDelta(prev.energyDeliveredTariff3, curr.energyDeliveredTariff3) * ratio;
    t4 += safeDelta(prev.energyDeliveredTariff4, curr.energyDeliveredTariff4) * ratio;
    coveredMs += overlapMs;
  }

  return {
    kwhUsed: +kwhUsed.toFixed(6),
    kwhByTariff: {
      t1: +t1.toFixed(6),
      t2: +t2.toFixed(6),
      t3: +t3.toFixed(6),
      t4: +t4.toFixed(6),
    },
    coveredMs,
  };
}

async function loadReadingsForPeriod(
  deviceId: number,
  startsAt: Date,
  endsAt: Date,
): Promise<ReadingRow[]> {
  const [beforeStart, inRange, afterEnd] = await Promise.all([
    prisma.reading.findFirst({
      where: { deviceId, timestamp: { lt: startsAt } },
      orderBy: { timestamp: 'desc' },
      select: READING_SELECT,
    }),
    prisma.reading.findMany({
      where: { deviceId, timestamp: { gte: startsAt, lte: endsAt } },
      orderBy: { timestamp: 'asc' },
      select: READING_SELECT,
    }),
    prisma.reading.findFirst({
      where: { deviceId, timestamp: { gt: endsAt } },
      orderBy: { timestamp: 'asc' },
      select: READING_SELECT,
    }),
  ]);

  const rows = [beforeStart, ...inRange, afterEnd].filter((r): r is ReadingRow => r != null);
  return rows.filter(
    (r, i) => i === 0 || r.timestamp.getTime() !== rows[i - 1]!.timestamp.getTime(),
  );
}

type AllocationRow = Awaited<ReturnType<typeof prisma.renterAllocation.findMany>>[number] & {
  renter: { id: number; name: string; email: string | null };
};

function buildTimelineSegments(
  allocations: AllocationRow[],
  periodStartsAt: Date,
  periodEndsAt: Date,
): Array<{ startsAt: Date; endsAt: Date; allocation: AllocationRow | null }> {
  const FAR_FUTURE = new Date('9999-12-31T23:59:59.999Z');

  const boundaries = new Set<number>([
    periodStartsAt.getTime(),
    periodEndsAt.getTime(),
  ]);

  for (const alloc of allocations) {
    const clampedStart = Math.max(alloc.startsAt.getTime(), periodStartsAt.getTime());
    const clampedEnd = alloc.endsAt
      ? Math.min(alloc.endsAt.getTime(), periodEndsAt.getTime())
      : periodEndsAt.getTime();
    boundaries.add(clampedStart);
    if (clampedEnd < periodEndsAt.getTime()) boundaries.add(clampedEnd);
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const segments: Array<{ startsAt: Date; endsAt: Date; allocation: AllocationRow | null }> = [];

  for (let i = 1; i < sorted.length; i++) {
    const segStart = new Date(sorted[i - 1]!);
    const segEnd = new Date(sorted[i]!);
    if (segEnd.getTime() <= segStart.getTime()) continue;

    const allocation =
      allocations.find((a) => {
        const aStart = a.startsAt.getTime();
        const aEnd = a.endsAt ? a.endsAt.getTime() : FAR_FUTURE.getTime();
        return aStart <= segStart.getTime() && aEnd > segStart.getTime();
      }) ?? null;

    segments.push({ startsAt: segStart, endsAt: segEnd, allocation });
  }

  return segments;
}

export async function allocateUsageForPeriod(
  deviceId: number,
  periodStartsAt: Date,
  periodEndsAt: Date,
): Promise<UsageAllocationResult> {
  const [readings, allocations] = await Promise.all([
    loadReadingsForPeriod(deviceId, periodStartsAt, periodEndsAt),
    prisma.renterAllocation.findMany({
      where: {
        deviceId,
        startsAt: { lt: periodEndsAt },
        OR: [{ endsAt: null }, { endsAt: { gt: periodStartsAt } }],
      },
      orderBy: { startsAt: 'asc' },
      include: {
        renter: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  const segments = buildTimelineSegments(allocations, periodStartsAt, periodEndsAt);

  const allocationMap = new Map<number, AllocationPeriodUsage>();
  const unallocatedPeriods: UnallocatedPeriod[] = [];

  for (const seg of segments) {
    const totalMs = seg.endsAt.getTime() - seg.startsAt.getTime();
    const energy = calculateKwhInSegment(readings, seg.startsAt, seg.endsAt);

    if (!seg.allocation) {
      unallocatedPeriods.push({
        startsAt: seg.startsAt,
        endsAt: seg.endsAt,
        kwhUsed: energy.kwhUsed,
        coveredMs: energy.coveredMs,
        totalMs,
      });
      continue;
    }

    const allocationId = seg.allocation.id;
    const existing = allocationMap.get(allocationId);

    if (existing) {
      existing.kwhUsed = +(existing.kwhUsed + energy.kwhUsed).toFixed(6);
      existing.kwhByTariff.t1 = +(existing.kwhByTariff.t1 + energy.kwhByTariff.t1).toFixed(6);
      existing.kwhByTariff.t2 = +(existing.kwhByTariff.t2 + energy.kwhByTariff.t2).toFixed(6);
      existing.kwhByTariff.t3 = +(existing.kwhByTariff.t3 + energy.kwhByTariff.t3).toFixed(6);
      existing.kwhByTariff.t4 = +(existing.kwhByTariff.t4 + energy.kwhByTariff.t4).toFixed(6);
      existing.coveredMs += energy.coveredMs;
      existing.totalMs += totalMs;
      if (seg.endsAt > existing.activeEndsAt) existing.activeEndsAt = seg.endsAt;
    } else {
      allocationMap.set(allocationId, {
        allocationId,
        renterId: seg.allocation.renter.id,
        renterName: seg.allocation.renter.name,
        renterEmail: seg.allocation.renter.email,
        allocationStartsAt: seg.allocation.startsAt,
        allocationEndsAt: seg.allocation.endsAt,
        activeStartsAt: seg.startsAt,
        activeEndsAt: seg.endsAt,
        kwhUsed: energy.kwhUsed,
        kwhByTariff: { ...energy.kwhByTariff },
        coveredMs: energy.coveredMs,
        totalMs,
      });
    }
  }

  const allocationPeriods = [...allocationMap.values()];
  const allocatedKwh = allocationPeriods.reduce((acc, r) => acc + r.kwhUsed, 0);
  const unallocatedKwh = +(unallocatedPeriods.reduce((acc, u) => acc + u.kwhUsed, 0)).toFixed(6);
  const totalKwh = +(allocatedKwh + unallocatedKwh).toFixed(6);

  return {
    deviceId,
    periodStartsAt,
    periodEndsAt,
    allocationPeriods,
    unallocatedPeriods,
    totalKwh,
    unallocatedKwh,
  };
}
