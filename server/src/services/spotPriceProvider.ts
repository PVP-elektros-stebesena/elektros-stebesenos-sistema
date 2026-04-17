import { addDaysToDateString, formatBillingDate } from './timezone.js';

export const SPOT_PRICE_PROVIDER_NAMES = ['ELERING'] as const;
export type SpotPriceProviderName = typeof SPOT_PRICE_PROVIDER_NAMES[number];

export const SPOT_PRICE_ZONES = ['LT'] as const;
export type SpotPriceZone = typeof SPOT_PRICE_ZONES[number];

export interface SpotPriceInterval {
  startsAt: Date;
  endsAt: Date;
  resolutionMinutes: number;
  priceEurPerMwh: number;
}

export interface SpotPriceProvider {
  readonly name: SpotPriceProviderName;
  fetchDay(zone: SpotPriceZone, billingDate: string): Promise<SpotPriceInterval[]>;
}

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export function isSpotPriceProviderName(value: string): value is SpotPriceProviderName {
  return (SPOT_PRICE_PROVIDER_NAMES as readonly string[]).includes(value);
}

export function isSpotPriceZone(value: string): value is SpotPriceZone {
  return (SPOT_PRICE_ZONES as readonly string[]).includes(value);
}

export function createSpotPriceProvider(
  providerName: SpotPriceProviderName,
  fetchImpl: FetchLike = fetch,
): SpotPriceProvider {
  switch (providerName) {
    case 'ELERING':
      return new EleringSpotPriceProvider(fetchImpl);
    default: {
      const unhandledProvider: never = providerName;
      throw new Error(`Unsupported spot price provider: ${unhandledProvider}`);
    }
  }
}

type FetchLike = typeof fetch;

type EleringResponse = {
  success: boolean;
  data?: Record<string, Array<{ timestamp: number; price: number }>>;
};

export class EleringSpotPriceProvider implements SpotPriceProvider {
  readonly name = 'ELERING' as const;

  private fetchImpl: FetchLike;
  private timeoutMs: number;

  constructor(fetchImpl: FetchLike = fetch, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async fetchDay(zone: SpotPriceZone, billingDate: string): Promise<SpotPriceInterval[]> {
    const queryStart = `${addDaysToDateString(billingDate, -1)}T00:00:00.000Z`;
    const queryEnd = `${addDaysToDateString(billingDate, 2)}T00:00:00.000Z`;
    const url = new URL('https://dashboard.elering.ee/api/nps/price');
    url.searchParams.set('start', queryStart);
    url.searchParams.set('end', queryEnd);
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(new Error(`Elering spot price request timed out after ${this.timeoutMs}ms`));
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), { signal: abortController.signal });
    } catch (error) {
      if (abortController.signal.aborted) {
        throw abortController.signal.reason instanceof Error
          ? abortController.signal.reason
          : new Error(`Elering spot price request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Elering spot price request failed with ${response.status}`);
    }

    const payload = await response.json() as EleringResponse;
    if (!payload.success || !payload.data) {
      throw new Error('Elering spot price response was not successful');
    }

    const rows = [...(payload.data[zone.toLowerCase()] ?? [])]
      .sort((a, b) => a.timestamp - b.timestamp);

    const filtered = rows.filter((row) => formatBillingDate(new Date(row.timestamp * 1000)) === billingDate);
    if (filtered.length === 0) {
      return [];
    }

    return filtered.map((row, index) => {
      const startsAt = new Date(row.timestamp * 1000);
      const sourceIndex = rows.findIndex((candidate) => candidate.timestamp === row.timestamp);
      const next = sourceIndex >= 0 ? rows[sourceIndex + 1] : undefined;
      const previous = filtered[index - 1];
      const fallbackResolutionMinutes = previous
        ? Math.max(1, Math.round(((row.timestamp - previous.timestamp) * 1000) / 60_000))
        : 15;
      const endsAt = next
        ? new Date(next.timestamp * 1000)
        : new Date(startsAt.getTime() + (fallbackResolutionMinutes * 60_000));

      return {
        startsAt,
        endsAt,
        resolutionMinutes: Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)),
        priceEurPerMwh: row.price,
      };
    });
  }
}
