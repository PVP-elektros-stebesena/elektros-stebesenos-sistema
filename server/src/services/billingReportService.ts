import prisma from '../lib/prisma.js';
import { allocateUsageForPeriod, type KwhByTariff } from './usageAllocationService.js';
import { costCalculatorService } from './costCalculator.js';

export interface BillingReportRenterEntry {
  renterId: number;
  renterName: string;
  renterEmail: string | null;
  periodStartsAt: string;
  periodEndsAt: string;
  kwhUsed: number;
  kwhByTariff: KwhByTariff;
  amountEur: number;
  energyChargeEur: number;
  fixedFeesEur: number;
  costStatus: string;
}

export interface BillingReportUnallocatedEntry {
  periodStartsAt: string;
  periodEndsAt: string;
  kwhUsed: number;
}

export interface BillingReportData {
  deviceId: number;
  deviceName: string;
  renterId: number | null;
  renterName: string | null;
  startsAt: string;
  endsAt: string;
  generatedAt: string;
  totalKwh: number;
  unallocatedKwh: number;
  renters: BillingReportRenterEntry[];
  unallocatedPeriods: BillingReportUnallocatedEntry[];
}

export interface StoredBillingReport {
  id: number;
  deviceId: number;
  renterId: number | null;
  startsAt: string;
  endsAt: string;
  generatedAt: string;
  totalKwh: number;
  unallocatedKwh: number;
  data: BillingReportData;
}

export type BillingReportSummary = Omit<StoredBillingReport, 'data'>;

export async function generateBillingReport(
  deviceId: number,
  startsAt: Date,
  endsAt: Date,
  landlordUserId: number,
  renterId?: number,
): Promise<StoredBillingReport> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, name: true, userId: true },
  });

  if (!device) throw new Error('DEVICE_NOT_FOUND');
  if (device.userId !== landlordUserId) throw new Error('DEVICE_NOT_OWNED');

  let renterName: string | null = null;
  if (renterId != null) {
    const renter = await prisma.renter.findUnique({ where: { id: renterId }, select: { name: true, landlordUserId: true } });
    if (!renter || renter.landlordUserId !== landlordUserId) throw new Error('RENTER_NOT_FOUND');
    renterName = renter.name;
  }

  const allocation = await allocateUsageForPeriod(deviceId, startsAt, endsAt);

  // For renter reports, include only the specified renter's periods
  const periods = renterId != null
    ? allocation.allocationPeriods.filter((p) => p.renterId === renterId)
    : allocation.allocationPeriods;

  const renterMap = new Map<number, BillingReportRenterEntry>();

  for (const period of periods) {
    const cost = await costCalculatorService.calculateEstimatedCost(
      deviceId,
      period.activeStartsAt,
      period.activeEndsAt,
    );

    const existing = renterMap.get(period.renterId);

    if (existing) {
      existing.kwhUsed = +(existing.kwhUsed + period.kwhUsed).toFixed(6);
      existing.kwhByTariff.t1 = +(existing.kwhByTariff.t1 + period.kwhByTariff.t1).toFixed(6);
      existing.kwhByTariff.t2 = +(existing.kwhByTariff.t2 + period.kwhByTariff.t2).toFixed(6);
      existing.kwhByTariff.t3 = +(existing.kwhByTariff.t3 + period.kwhByTariff.t3).toFixed(6);
      existing.kwhByTariff.t4 = +(existing.kwhByTariff.t4 + period.kwhByTariff.t4).toFixed(6);
      existing.amountEur = +(existing.amountEur + cost.totalEur).toFixed(4);
      existing.energyChargeEur = +(existing.energyChargeEur + cost.energyChargeEur).toFixed(4);
      existing.fixedFeesEur = +(existing.fixedFeesEur + cost.fixedFeesEur).toFixed(4);
      if (period.activeEndsAt > new Date(existing.periodEndsAt)) {
        existing.periodEndsAt = period.activeEndsAt.toISOString();
      }
    } else {
      renterMap.set(period.renterId, {
        renterId: period.renterId,
        renterName: period.renterName,
        renterEmail: period.renterEmail,
        periodStartsAt: period.activeStartsAt.toISOString(),
        periodEndsAt: period.activeEndsAt.toISOString(),
        kwhUsed: period.kwhUsed,
        kwhByTariff: { ...period.kwhByTariff },
        amountEur: cost.totalEur,
        energyChargeEur: cost.energyChargeEur,
        fixedFeesEur: cost.fixedFeesEur,
        costStatus: cost.status,
      });
    }
  }

  const renterEntries = [...renterMap.values()];
  const totalKwh = renterId != null
    ? +(renterEntries.reduce((acc, r) => acc + r.kwhUsed, 0)).toFixed(6)
    : allocation.totalKwh;
  const unallocatedKwh = renterId != null ? 0 : allocation.unallocatedKwh;
  const unallocatedPeriods = renterId != null ? [] : allocation.unallocatedPeriods.map((u) => ({
    periodStartsAt: u.startsAt.toISOString(),
    periodEndsAt: u.endsAt.toISOString(),
    kwhUsed: u.kwhUsed,
  }));

  const reportData: BillingReportData = {
    deviceId,
    deviceName: device.name,
    renterId: renterId ?? null,
    renterName,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    generatedAt: new Date().toISOString(),
    totalKwh,
    unallocatedKwh,
    renters: renterEntries,
    unallocatedPeriods,
  };

  const stored = await prisma.billingReport.create({
    data: {
      deviceId,
      renterId: renterId ?? null,
      startsAt,
      endsAt,
      totalKwh,
      unallocatedKwh,
      reportJson: JSON.stringify(reportData),
    },
  });

  return {
    id: stored.id,
    deviceId: stored.deviceId,
    renterId: stored.renterId,
    startsAt: stored.startsAt.toISOString(),
    endsAt: stored.endsAt.toISOString(),
    generatedAt: stored.generatedAt.toISOString(),
    totalKwh: stored.totalKwh,
    unallocatedKwh: stored.unallocatedKwh,
    data: reportData,
  };
}

export async function listBillingReports(
  deviceId: number,
  renterId?: number | null,
): Promise<BillingReportSummary[]> {
  const rows = await prisma.billingReport.findMany({
    where: {
      deviceId,
      ...(renterId === undefined ? {} : { renterId }),
    },
    orderBy: { generatedAt: 'desc' },
  });

  return rows.map((r) => ({
    id: r.id,
    deviceId: r.deviceId,
    renterId: r.renterId,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    generatedAt: r.generatedAt.toISOString(),
    totalKwh: r.totalKwh,
    unallocatedKwh: r.unallocatedKwh,
  }));
}

export async function getBillingReport(reportId: number): Promise<StoredBillingReport | null> {
  const row = await prisma.billingReport.findUnique({ where: { id: reportId } });
  if (!row) return null;

  return {
    id: row.id,
    deviceId: row.deviceId,
    renterId: row.renterId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    generatedAt: row.generatedAt.toISOString(),
    totalKwh: row.totalKwh,
    unallocatedKwh: row.unallocatedKwh,
    data: JSON.parse(row.reportJson) as BillingReportData,
  };
}
