import prisma from '../lib/prisma.js';
import { DEFAULT_POWER_POLICY, type EffectivePowerPolicy } from '../config/powerPolicy.js';
import { parseP1Response, toPowerReading, toVoltageReading } from './p1Parser.js';
import type { PowerWindowResult } from './powerAnalysis.js';
import { resolveEffectivePowerPolicy } from './powerPolicy.js';
import type { RmsWindowResult } from './voltageAnalysis.js';
import { AnomalyRepository } from './anomalyRepository.js';
import type { RuntimeProcessors } from './devicePollerTypes.js';

export class ReadingPipeline {
  private anomalyRepository: AnomalyRepository;

  constructor(anomalyRepository: AnomalyRepository) {
    this.anomalyRepository = anomalyRepository;
  }

  async processIncomingReading(
    deviceId: number,
    raw: Record<string, string>,
    now: Date,
    processors: RuntimeProcessors,
  ): Promise<void> {
    const p1Data = parseP1Response(raw);
    const voltageReading = toVoltageReading(p1Data, now);
    const powerReading = toPowerReading(p1Data, now);
    const policy = await this.resolvePolicy(deviceId, now);

    const voltageAnomalies = processors.tracker.processReading(voltageReading);
    const powerAnomalies = processors.powerTracker.processReading(powerReading, policy);
    const completedVoltageWindow = processors.windowMgr.addReading(voltageReading);
    const completedPowerWindow = processors.powerWindowMgr.addReading(powerReading, policy);

    await this.persistReadingAndWindows(deviceId, now, p1Data, completedVoltageWindow, completedPowerWindow);

    await Promise.all([
      this.anomalyRepository.persistVoltageAnomalies(deviceId, voltageAnomalies),
      this.anomalyRepository.persistPowerAnomalies(deviceId, powerAnomalies),
    ]);
  }

  async flushRuntime(deviceId: number, processors: RuntimeProcessors): Promise<void> {
    const operations: Array<Promise<unknown>> = [];

    const voltageWindow = processors.windowMgr.flush();
    if (voltageWindow) {
      operations.push(this.buildVoltageWindowUpsert(deviceId, voltageWindow));
    }

    const policy = await this.resolvePolicy(deviceId);
    const powerWindow = processors.powerWindowMgr.flush(policy);
    if (powerWindow) {
      operations.push(this.buildPowerWindowUpsert(deviceId, powerWindow));
    }

    await this.executeBatch(operations);
  }

  private async resolvePolicy(deviceId: number, at?: Date): Promise<EffectivePowerPolicy> {
    try {
      return await resolveEffectivePowerPolicy(deviceId, at ?? new Date());
    } catch {
      return DEFAULT_POWER_POLICY;
    }
  }

  private async persistReadingAndWindows(
    deviceId: number,
    timestamp: Date,
    p1Data: ReturnType<typeof parseP1Response>,
    completedVoltageWindow: RmsWindowResult | null,
    completedPowerWindow: PowerWindowResult | null,
  ): Promise<void> {
    const operations: Array<Promise<unknown>> = [
      prisma.reading.create({
        data: {
          deviceId,
          timestamp,
          ...p1Data,
        },
      }),
    ];

    if (completedVoltageWindow) {
      operations.push(this.buildVoltageWindowUpsert(deviceId, completedVoltageWindow));
    }

    if (completedPowerWindow) {
      operations.push(this.buildPowerWindowUpsert(deviceId, completedPowerWindow));
    }

    await this.executeBatch(operations);
  }

  private buildVoltageWindowUpsert(deviceId: number, window: RmsWindowResult): Promise<unknown> {
    return prisma.aggregatedData.upsert({
      where: {
        deviceId_startsAt_endsAt: {
          deviceId,
          startsAt: window.windowStart,
          endsAt: window.windowEnd,
        },
      },
      update: {
        voltageL1: window.rmsVoltageL1,
        voltageL2: window.rmsVoltageL2,
        voltageL3: window.rmsVoltageL3,
        outOfBoundsSecondsL1: window.outOfBoundsSecondsL1,
        outOfBoundsSecondsL2: window.outOfBoundsSecondsL2,
        outOfBoundsSecondsL3: window.outOfBoundsSecondsL3,
        compliantL1: window.compliantL1,
        compliantL2: window.compliantL2,
        compliantL3: window.compliantL3,
        sampleCount: window.sampleCount,
      },
      create: {
        deviceId,
        startsAt: window.windowStart,
        endsAt: window.windowEnd,
        voltageL1: window.rmsVoltageL1,
        voltageL2: window.rmsVoltageL2,
        voltageL3: window.rmsVoltageL3,
        outOfBoundsSecondsL1: window.outOfBoundsSecondsL1,
        outOfBoundsSecondsL2: window.outOfBoundsSecondsL2,
        outOfBoundsSecondsL3: window.outOfBoundsSecondsL3,
        compliantL1: window.compliantL1,
        compliantL2: window.compliantL2,
        compliantL3: window.compliantL3,
        sampleCount: window.sampleCount,
      },
    });
  }

  private buildPowerWindowUpsert(deviceId: number, window: PowerWindowResult): Promise<unknown> {
    return prisma.aggregatedData.upsert({
      where: {
        deviceId_startsAt_endsAt: {
          deviceId,
          startsAt: window.windowStart,
          endsAt: window.windowEnd,
        },
      },
      update: {
        sampleCount: window.sampleCount,
        activePowerAvgTotal: window.activePowerAvgTotal,
        activePowerMaxTotal: window.activePowerMaxTotal,
        reactivePowerAvgTotal: window.reactivePowerAvgTotal,
        reactivePowerMaxTotal: window.reactivePowerMaxTotal,
        apparentPowerAvgTotal: window.apparentPowerAvgTotal,
        apparentPowerMaxTotal: window.apparentPowerMaxTotal,
        powerFactorAvg: window.powerFactorAvg,
        activePowerAvgL1: window.activePowerAvgL1,
        activePowerAvgL2: window.activePowerAvgL2,
        activePowerAvgL3: window.activePowerAvgL3,
        reactivePowerAvgL1: window.reactivePowerAvgL1,
        reactivePowerAvgL2: window.reactivePowerAvgL2,
        reactivePowerAvgL3: window.reactivePowerAvgL3,
        powerImbalancePct: window.powerImbalancePct,
        powerPolicyBreached: window.powerPolicyBreached,
      },
      create: {
        deviceId,
        startsAt: window.windowStart,
        endsAt: window.windowEnd,
        sampleCount: window.sampleCount,
        activePowerAvgTotal: window.activePowerAvgTotal,
        activePowerMaxTotal: window.activePowerMaxTotal,
        reactivePowerAvgTotal: window.reactivePowerAvgTotal,
        reactivePowerMaxTotal: window.reactivePowerMaxTotal,
        apparentPowerAvgTotal: window.apparentPowerAvgTotal,
        apparentPowerMaxTotal: window.apparentPowerMaxTotal,
        powerFactorAvg: window.powerFactorAvg,
        activePowerAvgL1: window.activePowerAvgL1,
        activePowerAvgL2: window.activePowerAvgL2,
        activePowerAvgL3: window.activePowerAvgL3,
        reactivePowerAvgL1: window.reactivePowerAvgL1,
        reactivePowerAvgL2: window.reactivePowerAvgL2,
        reactivePowerAvgL3: window.reactivePowerAvgL3,
        powerImbalancePct: window.powerImbalancePct,
        powerPolicyBreached: window.powerPolicyBreached,
      },
    });
  }

  private async executeBatch(operations: Array<Promise<unknown>>): Promise<void> {
    if (operations.length === 0) return;

    const transaction = (prisma as { $transaction?: (ops: Array<Promise<unknown>>) => Promise<unknown[]> }).$transaction;

    if (typeof transaction === 'function') {
      await transaction.call(prisma, operations);
      return;
    }

    await Promise.all(operations);
  }
}
