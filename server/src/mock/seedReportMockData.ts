import prisma from '../lib/prisma.js';

interface SeedOptions {
  days: number;
  deviceName: string;
  pollIntervalSeconds: number;
}

function parseArgs(): SeedOptions {
  const args = process.argv.slice(2);

  const getArg = (name: string, fallback: string): string => {
    const idx = args.findIndex((a) => a === `--${name}`);
    if (idx === -1 || idx + 1 >= args.length) return fallback;
    return args[idx + 1] ?? fallback;
  };

  const days = Math.max(2, parseInt(getArg('days', '30'), 10) || 30);
  const deviceName = getArg('name', 'Mock Report Device');
  const pollIntervalSeconds = Math.max(1, parseInt(getArg('interval', '10'), 10) || 10);

  return { days, deviceName, pollIntervalSeconds };
}

function clamp(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function dayStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function inDayHours(base: Date, hour: number, minute: number): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function ensureDevice(name: string, pollIntervalSeconds: number) {
  const existing = await prisma.device.findFirst({ where: { name } });
  if (existing) return existing;

  return prisma.device.create({
    data: {
      name,
      deviceIp: 'http://127.0.0.1:3001/smartmeter/api/read',
      mqttBroker: 'localhost',
      mqttPort: 1883,
      mqttTopic: 'mock/topic',
      pollInterval: pollIntervalSeconds,
      isActive: true,
    },
  });
}

async function seedReadings(deviceId: number, days: number, now: Date) {
  const start = dayStart(new Date(now.getTime() - days * 24 * 3600_000));

  await prisma.reading.deleteMany({
    where: {
      deviceId,
      timestamp: { gte: start, lte: now },
    },
  });

  const rows: Array<{
    deviceId: number;
    timestamp: Date;
    energyDelivered: number;
    energyReturned: number;
    instantaneousVoltageL1: number;
    instantaneousVoltageL2: number;
    instantaneousVoltageL3: number;
    voltageL1: number;
    voltageL2: number;
    voltageL3: number;
    activeInstantaneousPowerDelivered: number;
    powerDeliveredTotal: number;
    powerReturnedTotal: number;
    powerDeliveredNetto: number;
  }> = [];

  let cumulativeDelivered = 1000;
  let cumulativeReturned = 120;

  for (let d = 0; d < days; d++) {
    const baseDay = new Date(start.getTime() + d * 24 * 3600_000);
    const dayFactor = 0.85 + 0.25 * Math.sin(d / 2.5);

    for (let h = 0; h < 24; h++) {
      const ts = inDayHours(baseDay, h, 0);
      if (ts > now) continue;

      const eveningPeak = h >= 18 && h <= 22 ? 0.9 : 0;
      const baseLoadKw = 0.6 + eveningPeak + 0.15 * Math.sin((h / 24) * Math.PI * 2);
      
      const consumedKw = Math.max(0.15, baseLoadKw * dayFactor);
      
      
      const hasSun = h >= 7 && h <= 19;
      const cloudFactor = 1 - 0.6 * Math.sin(d * 1.5); 
      const rawSolarKw = Math.sin(((h - 6) / 12) * Math.PI) * 1.5 * cloudFactor;
      const computedSolarKw = clamp(0, hasSun ? rawSolarKw : 0, 2.5);

      let gridUsed = Math.max(0, consumedKw - computedSolarKw);
      let exportedKw = Math.max(0, computedSolarKw - consumedKw);
      
      
      if (hasSun && computedSolarKw > 0) {
        const mixingFactor = 0.1 + (Math.random() * 0.4); 
        const baseActivity = Math.min(consumedKw, computedSolarKw);
        gridUsed += baseActivity * mixingFactor;
        exportedKw += baseActivity * mixingFactor;
      }
      
      const netImportKw = gridUsed + (Math.random() * 0.05);
      exportedKw += (Math.random() * 0.05);

      cumulativeDelivered += netImportKw;
      cumulativeReturned += exportedKw;

      const vShift = d % 5 === 0 && h >= 9 && h <= 11 ? -12 : 0;
      const l1 = 230 + vShift + 1.2 * Math.sin(h / 3);
      const l2 = 229 + vShift + 1.1 * Math.cos(h / 4);
      const l3 = 231 + vShift + 0.9 * Math.sin(h / 5);

      rows.push({
        deviceId,
        timestamp: ts,
        energyDelivered: +cumulativeDelivered.toFixed(3),
        energyReturned: +cumulativeReturned.toFixed(3),
        instantaneousVoltageL1: +l1.toFixed(3),
        instantaneousVoltageL2: +l2.toFixed(3),
        instantaneousVoltageL3: +l3.toFixed(3),
        voltageL1: +l1.toFixed(3),
        voltageL2: +l2.toFixed(3),
        voltageL3: +l3.toFixed(3),
        activeInstantaneousPowerDelivered: +netImportKw.toFixed(3),
        powerDeliveredTotal: +netImportKw.toFixed(3),
        powerReturnedTotal: +exportedKw.toFixed(3),
        powerDeliveredNetto: +(netImportKw - exportedKw).toFixed(3),
      });
    }
  }

  if (rows.length > 0) {
    await prisma.reading.createMany({ data: rows });
  }

  return { start, count: rows.length };
}

async function seedAggregatesAndAnomalies(deviceId: number, start: Date, now: Date) {
  await prisma.aggregatedData.deleteMany({
    where: {
      deviceId,
      startsAt: { gte: start, lte: now },
    },
  });

  await prisma.anomaly.deleteMany({
    where: {
      deviceId,
      startsAt: { gte: start, lte: now },
    },
  });

  const windows: Array<{
    deviceId: number;
    startsAt: Date;
    endsAt: Date;
    voltageL1: number;
    voltageL2: number;
    voltageL3: number;
    outOfBoundsSecondsL1: number;
    outOfBoundsSecondsL2: number;
    outOfBoundsSecondsL3: number;
    compliantL1: boolean;
    compliantL2: boolean;
    compliantL3: boolean;
    sampleCount: number;
  }> = [];

  const anomalies: Array<{
    deviceId: number;
    startsAt: Date;
    endsAt: Date;
    phase: string;
    type: string;
    severity: number;
    minVoltage: number;
    maxVoltage: number;
    duration: number;
    description: string;
  }> = [];

  let cursor = new Date(start);
  while (cursor < now) {
    const windowStart = new Date(cursor);
    const windowEnd = new Date(cursor.getTime() + 10 * 60_000);

    const hour = windowStart.getHours();
    const minute = windowStart.getMinutes();
    const day = windowStart.getDate();
    const underVoltageWindow = day % 5 === 0 && hour >= 9 && hour <= 11;
    const overVoltageWindow = day % 6 === 0 && hour >= 19 && hour <= 20;
    const deviationL3Window = day % 4 === 0 && hour >= 14 && hour <= 15;
    const shortInterruptionWindow = day % 8 === 0 && hour === 6 && minute < 20;
    const longInterruptionWindow = day % 11 === 0 && hour === 2 && minute < 40;

    let v1 = 229 + 1.5 * Math.sin(hour / 2);
    let v2 = 230 + 1.2 * Math.cos(hour / 2);
    let v3 = 231 + 1.1 * Math.sin(hour / 3);

    if (underVoltageWindow) {
      v1 = 216;
      v2 = 217;
      v3 = 218;
    }

    if (overVoltageWindow) {
      v1 = 242;
      v2 = 246;
      v3 = 244;
    }

    if (deviationL3Window) {
      v3 = 241;
    }

    if (shortInterruptionWindow || longInterruptionWindow) {
      v1 = 0;
      v2 = 0;
      v3 = 0;
    }

    const c1 = v1 >= 220 && v1 <= 240;
    const c2 = v2 >= 220 && v2 <= 240;
    const c3 = v3 >= 220 && v3 <= 240;

    windows.push({
      deviceId,
      startsAt: windowStart,
      endsAt: windowEnd,
      voltageL1: +v1.toFixed(3),
      voltageL2: +v2.toFixed(3),
      voltageL3: +v3.toFixed(3),
      outOfBoundsSecondsL1: c1 ? 0 : 600,
      outOfBoundsSecondsL2: c2 ? 0 : 600,
      outOfBoundsSecondsL3: c3 ? 0 : 600,
      compliantL1: c1,
      compliantL2: c2,
      compliantL3: c3,
      sampleCount: 60,
    });

    if (underVoltageWindow && hour === 9 && minute === 0) {
      anomalies.push({
        deviceId,
        startsAt: windowStart,
        endsAt: new Date(windowStart.getTime() + 20 * 60_000),
        phase: 'L1',
        type: 'UNDER_VOLTAGE',
        severity: 1,
        minVoltage: 214,
        maxVoltage: 219,
        duration: 1200,
        description: 'Simulated under-voltage event for report testing',
      });
    }

    if (overVoltageWindow && hour === 19 && minute === 0) {
      anomalies.push({
        deviceId,
        startsAt: windowStart,
        endsAt: new Date(windowStart.getTime() + 2 * 3600_000),
        phase: 'L2',
        type: 'OVER_VOLTAGE',
        severity: 1,
        minVoltage: 241,
        maxVoltage: 247,
        duration: 7200,
        description: 'Simulated over-voltage evening event for report testing',
      });
    }

    if (deviationL3Window && hour === 14 && minute === 0) {
      anomalies.push({
        deviceId,
        startsAt: windowStart,
        endsAt: new Date(windowStart.getTime() + 2 * 3600_000),
        phase: 'L3',
        type: 'VOLTAGE_DEVIATION',
        severity: 1,
        minVoltage: 219,
        maxVoltage: 241,
        duration: 7200,
        description: 'Simulated voltage deviation event for report testing',
      });
    }

    if (shortInterruptionWindow && hour === 6 && minute === 0) {
      anomalies.push({
        deviceId,
        startsAt: windowStart,
        endsAt: new Date(windowStart.getTime() + 20 * 60_000),
        phase: 'ALL',
        type: 'SHORT_INTERRUPTION',
        severity: 1,
        minVoltage: 0,
        maxVoltage: 0,
        duration: 1200,
        description: 'Simulated short interruption for report testing',
      });
    }

    if (longInterruptionWindow && hour === 2 && minute === 0) {
      anomalies.push({
        deviceId,
        startsAt: windowStart,
        endsAt: new Date(windowStart.getTime() + 40 * 60_000),
        phase: 'ALL',
        type: 'LONG_INTERRUPTION',
        severity: 2,
        minVoltage: 0,
        maxVoltage: 0,
        duration: 2400,
        description: 'Simulated long interruption for report testing',
      });
    }

    cursor = windowEnd;
  }

  if (windows.length > 0) {
    await prisma.aggregatedData.createMany({ data: windows });
  }

  if (anomalies.length > 0) {
    await prisma.anomaly.createMany({ data: anomalies });
  }

  return { windows: windows.length, anomalies: anomalies.length };
}

async function main() {
  const { days, deviceName, pollIntervalSeconds } = parseArgs();
  const now = new Date();

  const device = await ensureDevice(deviceName, pollIntervalSeconds);
  const readingResult = await seedReadings(device.id, days, now);
  const qaResult = await seedAggregatesAndAnomalies(device.id, readingResult.start, now);

  console.log('[seedReportMockData] Seed complete');
  console.log(`  Device: ${device.name} (id=${device.id})`);
  console.log(`  Days: ${days}`);
  console.log(`  Readings: ${readingResult.count}`);
  console.log(`  Aggregated windows: ${qaResult.windows}`);
  console.log(`  Anomalies: ${qaResult.anomalies}`);
  console.log(`  Range: ${readingResult.start.toISOString()} -> ${now.toISOString()}`);
}

main()
  .catch((err) => {
    console.error('[seedReportMockData] Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
