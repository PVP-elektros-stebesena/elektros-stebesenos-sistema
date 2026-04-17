import prisma from '../lib/prisma.js';
import {
  createSpotPriceProvider,
  type SpotPriceInterval,
  type SpotPriceProviderName,
  type SpotPriceProvider,
  type SpotPriceZone,
} from './spotPriceProvider.js';
import {
  addDaysToDateString,
  getExpectedQuarterHourIntervals,
  getTomorrowBillingDate,
} from './timezone.js';

export interface SpotPriceSyncResult {
  provider: SpotPriceProviderName;
  zone: SpotPriceZone;
  billingDate: string;
  intervalsStored: number;
  expectedIntervals: number;
  complete: boolean;
}

export class SpotPriceSyncService {
  private provider: SpotPriceProvider;

  constructor(provider: SpotPriceProvider = createSpotPriceProvider('ELERING')) {
    this.provider = provider;
  }

  getProviderName(): SpotPriceProviderName {
    return this.provider.name;
  }

  async syncBillingDate(
    billingDate: string,
    zone: SpotPriceZone = 'LT',
  ): Promise<SpotPriceSyncResult> {
    const intervals = await this.provider.fetchDay(zone, billingDate);
    await this.persistIntervals(zone, intervals);

    const expectedIntervals = getExpectedQuarterHourIntervals(billingDate);
    return {
      provider: this.provider.name,
      zone,
      billingDate,
      intervalsStored: intervals.length,
      expectedIntervals,
      complete: intervals.length === expectedIntervals,
    };
  }

  async syncTomorrow(zone: SpotPriceZone = 'LT'): Promise<SpotPriceSyncResult> {
    return this.syncBillingDate(getTomorrowBillingDate(), zone);
  }

  async backfillRecentDays(days: number, zone: SpotPriceZone = 'LT'): Promise<SpotPriceSyncResult[]> {
    const count = Math.max(0, Math.floor(days));
    const tomorrow = getTomorrowBillingDate();
    const results: SpotPriceSyncResult[] = [];

    for (let offset = count; offset >= 0; offset -= 1) {
      const target = addDaysToDateString(tomorrow, -offset);
      results.push(await this.syncBillingDate(target, zone));
    }

    return results;
  }

  private async persistIntervals(zone: SpotPriceZone, intervals: SpotPriceInterval[]): Promise<void> {
    if (intervals.length === 0) return;

    await Promise.all(intervals.map((interval) => (
      prisma.spotPrice.upsert({
        where: {
          provider_zone_startsAt: {
            provider: this.provider.name,
            zone,
            startsAt: interval.startsAt,
          },
        },
        update: {
          endsAt: interval.endsAt,
          resolutionMinutes: interval.resolutionMinutes,
          priceEurPerMwh: interval.priceEurPerMwh,
          fetchedAt: new Date(),
        },
        create: {
          provider: this.provider.name,
          zone,
          startsAt: interval.startsAt,
          endsAt: interval.endsAt,
          resolutionMinutes: interval.resolutionMinutes,
          priceEurPerMwh: interval.priceEurPerMwh,
        },
      })
    )));
  }
}

export const spotPriceSyncService = new SpotPriceSyncService();
