import type { FastifyInstance, FastifyReply } from 'fastify';
import * as XLSX from 'xlsx';
import prisma from '../lib/prisma.js';
import {
  generateBillingReport,
  listBillingReports,
  getBillingReport,
} from '../services/billingReportService.js';

function requireAuthUserId(
  req: { authUser?: { id: number } },
  reply: FastifyReply,
): number | null {
  if (!req.authUser?.id) {
    reply.code(401).send({ error: 'UNAUTHENTICATED', message: 'Log in to access this resource.' });
    return null;
  }
  return req.authUser.id;
}

function escapeCsv(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

interface GenerateBody {
  deviceId: number;
  renterId?: number;
  startsAt: string;
  endsAt: string;
}

interface IdParam {
  id: string;
}

interface ExportQuery {
  format?: string;
}

interface ListQuery {
  deviceId?: string;
  renterId?: string;
}

export async function billingReportRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: GenerateBody }>(
    '/api/billing-reports',
    {
      schema: {
        body: {
          type: 'object',
          required: ['deviceId', 'startsAt', 'endsAt'],
          additionalProperties: false,
          properties: {
            deviceId: { type: 'integer', minimum: 1 },
            renterId: { type: 'integer', minimum: 1 },
            startsAt: { type: 'string', minLength: 1 },
            endsAt: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const landlordUserId = requireAuthUserId(req, reply);
      if (landlordUserId == null) return;

      const startsAt = new Date(req.body.startsAt);
      const endsAt = new Date(req.body.endsAt);

      if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
        return reply.code(400).send({ error: 'INVALID_DATE', message: 'Invalid date values.' });
      }
      if (endsAt <= startsAt) {
        return reply.code(400).send({ error: 'INVALID_DATE', message: 'endsAt must be after startsAt.' });
      }

      try {
        const report = await generateBillingReport(req.body.deviceId, startsAt, endsAt, landlordUserId, req.body.renterId);
        return reply.code(201).send(report);
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.message === 'DEVICE_NOT_FOUND') {
            return reply.code(404).send({ error: 'NOT_FOUND', message: 'Device not found.' });
          }
          if (err.message === 'DEVICE_NOT_OWNED') {
            return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied.' });
          }
        }
        throw err;
      }
    },
  );

  fastify.get<{ Querystring: ListQuery }>('/api/billing-reports', async (req, reply) => {
    const landlordUserId = requireAuthUserId(req, reply);
    if (landlordUserId == null) return;

    const deviceId = parseInt(req.query.deviceId ?? '', 10);
    if (isNaN(deviceId) || deviceId < 1) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'deviceId query param is required.' });
    }

    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { userId: true },
    });

    if (!device) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Device not found.' });
    }
    if (device.userId !== landlordUserId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied.' });
    }

    const renterIdRaw = req.query.renterId;
    const renterId = renterIdRaw != null ? parseInt(renterIdRaw, 10) : undefined;
    const reports = await listBillingReports(deviceId, renterId);
    return reply.send(reports);
  });

  fastify.get<{ Params: IdParam }>('/api/billing-reports/:id', async (req, reply) => {
    const landlordUserId = requireAuthUserId(req, reply);
    if (landlordUserId == null) return;

    const reportId = parseInt(req.params.id, 10);
    if (isNaN(reportId)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid report id.' });
    }

    const report = await getBillingReport(reportId);
    if (!report) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Report not found.' });
    }

    const device = await prisma.device.findUnique({
      where: { id: report.deviceId },
      select: { userId: true },
    });
    if (!device || device.userId !== landlordUserId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied.' });
    }

    return reply.send(report);
  });

  fastify.get<{ Params: IdParam; Querystring: ExportQuery }>(
    '/api/billing-reports/:id/export',
    async (req, reply) => {
      const landlordUserId = requireAuthUserId(req, reply);
      if (landlordUserId == null) return;

      const reportId = parseInt(req.params.id, 10);
      if (isNaN(reportId)) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid report id.' });
      }

      const report = await getBillingReport(reportId);
      if (!report) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Report not found.' });
      }

      const device = await prisma.device.findUnique({
        where: { id: report.deviceId },
        select: { userId: true },
      });
      if (!device || device.userId !== landlordUserId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied.' });
      }

      const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
      const { data } = report;
      const safeFrom = data.startsAt.slice(0, 10);
      const safeTo = data.endsAt.slice(0, 10);
      const baseName = `billing-report-device-${report.deviceId}-${safeFrom}-to-${safeTo}`;

      const totalAmountEur = data.renters.reduce((acc, r) => acc + r.amountEur, 0);
      const totalEnergyChargeEur = data.renters.reduce((acc, r) => acc + r.energyChargeEur, 0);
      const totalFixedFeesEur = data.renters.reduce((acc, r) => acc + r.fixedFeesEur, 0);

      const rows = [
        ...data.renters.map((r) => ({
          type: 'renter',
          renterName: r.renterName,
          renterEmail: r.renterEmail ?? '',
          periodStartsAt: r.periodStartsAt,
          periodEndsAt: r.periodEndsAt,
          kwhUsed: r.kwhUsed,
          kwhT1: r.kwhByTariff.t1,
          kwhT2: r.kwhByTariff.t2,
          kwhT3: r.kwhByTariff.t3,
          kwhT4: r.kwhByTariff.t4,
          amountEur: r.amountEur,
          energyChargeEur: r.energyChargeEur,
          fixedFeesEur: r.fixedFeesEur,
          costStatus: r.costStatus,
        })),
        ...data.unallocatedPeriods.map((u) => ({
          type: 'unallocated',
          renterName: '(Unallocated)',
          renterEmail: '',
          periodStartsAt: u.periodStartsAt,
          periodEndsAt: u.periodEndsAt,
          kwhUsed: u.kwhUsed,
          kwhT1: '',
          kwhT2: '',
          kwhT3: '',
          kwhT4: '',
          amountEur: '',
          energyChargeEur: '',
          fixedFeesEur: '',
          costStatus: '',
        })),
        {
          type: 'TOTAL',
          renterName: 'TOTAL',
          renterEmail: '',
          periodStartsAt: data.startsAt,
          periodEndsAt: data.endsAt,
          kwhUsed: data.totalKwh,
          kwhT1: '',
          kwhT2: '',
          kwhT3: '',
          kwhT4: '',
          amountEur: +totalAmountEur.toFixed(4),
          energyChargeEur: +totalEnergyChargeEur.toFixed(4),
          fixedFeesEur: +totalFixedFeesEur.toFixed(4),
          costStatus: '',
        },
      ];

      if (format === 'xlsx') {
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Billing Report');
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        reply.header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        reply.header('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
        return reply.send(buffer);
      }

      const headers = Object.keys(rows[0] ?? {});
      const csv = [
        headers.join(','),
        ...rows.map((row) =>
          headers.map((h) => escapeCsv(row[h as keyof typeof row])).join(','),
        ),
      ].join('\n');

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      return reply.send(csv);
    },
  );
}
