import nodemailer, { type SendMailOptions } from 'nodemailer';
import prisma from '../lib/prisma.js';
import type { NotificationMessage, NotificationSender } from './notificationTypes.js';

export type SendMailFn = (input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) => Promise<void>;

function formatMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return 'none';
  }

  return JSON.stringify(metadata, null, 2);
}

function toEmailText(message: NotificationMessage): string {
  return [
    `Event: ${message.eventType}`,
    `Severity: ${message.severity}`,
    `Occurred at: ${message.occurredAt.toISOString()}`,
    `Device ID: ${message.deviceId ?? 'n/a'}`,
    '',
    `Title: ${message.title}`,
    `Body: ${message.body}`,
    '',
    'Metadata:',
    formatMetadata(message.metadata),
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function severityColor(severity: NotificationMessage['severity']): string {
  if (severity === 'CRITICAL') return '#DB3C3C';
  if (severity === 'WARNING') return '#FFCC59';
  return '#8ACDEA';
}

function toEmailHtml(message: NotificationMessage): string {
  const metadata = formatMetadata(message.metadata);
  const color = severityColor(message.severity);
  const deviceLabel = message.deviceId ?? 'n/a';

  return `
  <div style="background:#F8F9FB;padding:24px;font-family:Roboto,Arial,sans-serif;color:#1F2937;">
    <div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
      <div style="padding:14px 18px;border-bottom:1px solid #E5E7EB;">
        <div style="font-size:14px;color:#6B7280;">Elektros stebėsenos sistema</div>
      </div>

      <div style="padding:18px;">
        <div style="margin:0 0 12px;">
          <span style="display:inline-block;font-size:12px;font-weight:600;padding:5px 10px;border-radius:999px;background:${color};color:#111827;">${escapeHtml(message.severity)}</span>
        </div>

        <h2 style="margin:0 0 10px;font-size:20px;font-weight:500;color:#111827;">${escapeHtml(message.title)}</h2>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#1F2937;">${escapeHtml(message.body)}</p>

        <div style="display:grid;grid-template-columns:130px 1fr;gap:8px 12px;font-size:13px;line-height:1.5;margin-bottom:14px;">
          <div style="color:#6B7280;">Event</div><div>${escapeHtml(message.eventType)}</div>
          <div style="color:#6B7280;">Occurred</div><div>${escapeHtml(message.occurredAt.toISOString())}</div>
          <div style="color:#6B7280;">Device ID</div><div>${escapeHtml(String(deviceLabel))}</div>
        </div>

        <div style="font-size:12px;color:#6B7280;margin-bottom:6px;">Metadata</div>
        <pre style="margin:0;background:#F8F9FB;border:1px solid #E5E7EB;border-radius:8px;padding:12px;overflow:auto;font-size:12px;line-height:1.5;color:#1F2937;">${escapeHtml(metadata)}</pre>
      </div>
    </div>
  </div>`;
}

function parsePort(rawPort: string | undefined): number {
  const value = Number.parseInt(rawPort ?? '587', 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('BREVO_SMTP_PORT must be a positive integer');
  }
  return value;
}

function parseSecure(rawSecure: string | undefined): boolean {
  if (!rawSecure) return false;
  return ['1', 'true', 'yes', 'on'].includes(rawSecure.trim().toLowerCase());
}

async function resolveRecipient(
  message: NotificationMessage,
  fallbackRecipient?: string,
): Promise<string | null> {
  if (message.deviceId != null) {
    const device = await prisma.device.findUnique({
      where: { id: message.deviceId },
      select: {
        notificationChannel: true,
        notificationTarget: true,
      },
    });

    if (!device) {
      return fallbackRecipient ?? null;
    }

    if (device.notificationChannel !== 'email') {
      return null;
    }

    const target = device.notificationTarget?.trim();
    if (target) {
      return target;
    }

    return fallbackRecipient ?? null;
  }

  return fallbackRecipient ?? null;
}

export class EmailNotificationSender implements NotificationSender {
  constructor(
    private readonly sendMailFn: SendMailFn,
    private readonly fallbackRecipient?: string,
  ) {}

  async send(message: NotificationMessage): Promise<void> {
    const recipient = await resolveRecipient(message, this.fallbackRecipient);

    if (!recipient) {
      return;
    }

    const subject = `${message.title} | ${message.severity}`;
    const text = toEmailText(message);
    const html = toEmailHtml(message);

    await this.sendMailFn({
      to: recipient,
      subject,
      text,
      html,
    });
  }
}

export function createBrevoSendMailFn(env: NodeJS.ProcessEnv = process.env): SendMailFn | null {
  const host = env.BREVO_SMTP_HOST ?? 'smtp-relay.brevo.com';
  const port = parsePort(env.BREVO_SMTP_PORT);
  const secure = parseSecure(env.BREVO_SMTP_SECURE);
  const user = env.BREVO_SMTP_USER;
  const pass = env.BREVO_SMTP_PASS;
  const from = env.NOTIFICATION_EMAIL_FROM;

  if (!user || !pass || !from) {
    return null;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return async ({ to, subject, text, html }) => {
    const mail: SendMailOptions = {
      from,
      to,
      subject,
      text,
      html,
    };

    await transporter.sendMail(mail);
  };
}

export function createBrevoEmailNotificationSender(
  env: NodeJS.ProcessEnv = process.env,
): EmailNotificationSender | null {
  const sendMailFn = createBrevoSendMailFn(env);
  if (!sendMailFn) return null;

  return new EmailNotificationSender(sendMailFn, env.NOTIFICATION_EMAIL_TO);
}