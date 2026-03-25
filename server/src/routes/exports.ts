import type { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma.js';
import * as XLSX from 'xlsx';

interface ExportQuery {
  deviceId?: string;
  from?: string;
  to?: string;
  format?: string;
}

function parseDate(val: string | undefined): Date | null {
  if (!val) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDeviceId(val: string | undefined): number | null {
  if (!val) return null;
  const n = Number.parseInt(val, 10);
  return Number.isNaN(n) ? null : n;
}

function escapeCsv(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: ExportQuery }>('/api/exports/readings', async (req, reply) => {
    const deviceId = parseDeviceId(req.query.deviceId);
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const format = req.query.format;

    if (!deviceId) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'deviceId is required' });
    }

    if (!from || !to) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: 'from and to are required and must be valid dates',
      });
    }

    if (from >= to) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: '"from" must be before "to"',
      });
    }

    if (format !== 'csv' && format !== 'xlsx') {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: 'format must be csv or xlsx',
      });
    }

    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, name: true },
    });

    if (!device) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: `Device ${deviceId} not found`,
      });
    }

    const readings = await prisma.reading.findMany({
      where: {
        deviceId,
        timestamp: { gte: from, lte: to },
      },
      orderBy: { timestamp: 'asc' },
    });

    const rows = readings.map((r) => ({
      deviceId: r.deviceId,
      deviceName: device.name,
      timestamp: r.timestamp.toISOString(),

      electricityTariff: r.electricityTariff,
      energyDelivered: r.energyDelivered,
      energyReturned: r.energyReturned,
      reactiveEnergyDelivered: r.reactiveEnergyDelivered,
      reactiveEnergyReturned: r.reactiveEnergyReturned,

      energyDeliveredTariff1: r.energyDeliveredTariff1,
      energyDeliveredTariff2: r.energyDeliveredTariff2,
      energyDeliveredTariff3: r.energyDeliveredTariff3,
      energyDeliveredTariff4: r.energyDeliveredTariff4,

      energyReturnedTariff1: r.energyReturnedTariff1,
      energyReturnedTariff2: r.energyReturnedTariff2,
      energyReturnedTariff3: r.energyReturnedTariff3,
      energyReturnedTariff4: r.energyReturnedTariff4,

      reactiveEnergyDeliveredTariff1: r.reactiveEnergyDeliveredTariff1,
      reactiveEnergyDeliveredTariff2: r.reactiveEnergyDeliveredTariff2,
      reactiveEnergyDeliveredTariff3: r.reactiveEnergyDeliveredTariff3,
      reactiveEnergyDeliveredTariff4: r.reactiveEnergyDeliveredTariff4,

      reactiveEnergyReturnedTariff1: r.reactiveEnergyReturnedTariff1,
      reactiveEnergyReturnedTariff2: r.reactiveEnergyReturnedTariff2,
      reactiveEnergyReturnedTariff3: r.reactiveEnergyReturnedTariff3,
      reactiveEnergyReturnedTariff4: r.reactiveEnergyReturnedTariff4,

      instantaneousVoltageL1: r.instantaneousVoltageL1,
      voltageL1: r.voltageL1,
      instantaneousCurrentL1: r.instantaneousCurrentL1,
      currentL1: r.currentL1,

      instantaneousVoltageL2: r.instantaneousVoltageL2,
      voltageL2: r.voltageL2,
      instantaneousCurrentL2: r.instantaneousCurrentL2,
      currentL2: r.currentL2,

      instantaneousVoltageL3: r.instantaneousVoltageL3,
      voltageL3: r.voltageL3,
      instantaneousCurrentL3: r.instantaneousCurrentL3,
      currentL3: r.currentL3,

      instantaneousVoltage: r.instantaneousVoltage,
      instantaneousCurrent: r.instantaneousCurrent,
      instantaneousCurrentNeutral: r.instantaneousCurrentNeutral,
      currentNeutral: r.currentNeutral,
      frequency: r.frequency,

      activeInstantaneousPowerDelivered: r.activeInstantaneousPowerDelivered,
      activeInstantaneousPowerDeliveredL1: r.activeInstantaneousPowerDeliveredL1,
      activeInstantaneousPowerDeliveredL2: r.activeInstantaneousPowerDeliveredL2,
      activeInstantaneousPowerDeliveredL3: r.activeInstantaneousPowerDeliveredL3,

      activeInstantaneousPowerReturnedL1: r.activeInstantaneousPowerReturnedL1,
      activeInstantaneousPowerReturnedL2: r.activeInstantaneousPowerReturnedL2,
      activeInstantaneousPowerReturnedL3: r.activeInstantaneousPowerReturnedL3,

      reactiveInstantaneousPowerDeliveredL1: r.reactiveInstantaneousPowerDeliveredL1,
      reactiveInstantaneousPowerDeliveredL2: r.reactiveInstantaneousPowerDeliveredL2,
      reactiveInstantaneousPowerDeliveredL3: r.reactiveInstantaneousPowerDeliveredL3,

      reactiveInstantaneousPowerReturnedL1: r.reactiveInstantaneousPowerReturnedL1,
      reactiveInstantaneousPowerReturnedL2: r.reactiveInstantaneousPowerReturnedL2,
      reactiveInstantaneousPowerReturnedL3: r.reactiveInstantaneousPowerReturnedL3,

      apparentInstantaneousPower: r.apparentInstantaneousPower,
      apparentInstantaneousPowerL1: r.apparentInstantaneousPowerL1,
      apparentInstantaneousPowerL2: r.apparentInstantaneousPowerL2,
      apparentInstantaneousPowerL3: r.apparentInstantaneousPowerL3,

      powerDeliveredTotal: r.powerDeliveredTotal,
      powerReturnedTotal: r.powerReturnedTotal,
      reactiveEnergyDeliveredCurrentPeriod: r.reactiveEnergyDeliveredCurrentPeriod,
      reactiveEnergyReturnedCurrentPeriod: r.reactiveEnergyReturnedCurrentPeriod,
      powerDeliveredNetto: r.powerDeliveredNetto,
    }));

    const safeFrom = from.toISOString().slice(0, 10);
    const safeTo = to.toISOString().slice(0, 10);
    const baseName = `readings-device-${deviceId}-${safeFrom}-to-${safeTo}`;

    if (format === 'csv') {
      const headers = Object.keys(rows[0] ?? { deviceId: '', deviceName: '', timestamp: '' });
      const csv = [
        headers.join(','),
        ...rows.map((row) =>
          headers.map((header) => escapeCsv(row[header as keyof typeof row])).join(','),
        ),
      ].join('\n');

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      return reply.send(csv);
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Readings');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    reply.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    reply.header('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
    return reply.send(buffer);
  });
}