import { describe, expect, it, vi } from 'vitest';
import { EleringSpotPriceProvider } from '../spotPriceProvider.js';

describe('EleringSpotPriceProvider', () => {
  it('parses LT quarter-hour intervals for the requested billing date', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          lt: [
            { timestamp: Math.floor(new Date('2026-04-17T20:45:00.000Z').getTime() / 1000), price: 90 },
            { timestamp: Math.floor(new Date('2026-04-17T21:00:00.000Z').getTime() / 1000), price: 100 },
            { timestamp: Math.floor(new Date('2026-04-17T21:15:00.000Z').getTime() / 1000), price: 110 },
            { timestamp: Math.floor(new Date('2026-04-17T21:30:00.000Z').getTime() / 1000), price: 120 },
          ],
        },
      }),
    }));

    const provider = new EleringSpotPriceProvider(fetchMock as unknown as typeof fetch);
    const intervals = await provider.fetchDay('LT', '2026-04-18');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(intervals).toHaveLength(3);
    expect(intervals[0]).toMatchObject({
      startsAt: new Date('2026-04-17T21:00:00.000Z'),
      endsAt: new Date('2026-04-17T21:15:00.000Z'),
      resolutionMinutes: 15,
      priceEurPerMwh: 100,
    });
    expect(intervals[2]).toMatchObject({
      startsAt: new Date('2026-04-17T21:30:00.000Z'),
      endsAt: new Date('2026-04-17T21:45:00.000Z'),
      resolutionMinutes: 15,
      priceEurPerMwh: 120,
    });
  });

  it('aborts when the upstream request exceeds the timeout', async () => {
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason ?? new Error('aborted'));
      });
    }));

    const provider = new EleringSpotPriceProvider(fetchMock as unknown as typeof fetch, 5);

    await expect(provider.fetchDay('LT', '2026-04-18')).rejects.toThrow(/timed out/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
