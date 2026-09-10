import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * One pooled SMTP transport per process. Pooling matters because the worker can
 * send a burst of alerts when several monitors fail at once.
 *
 * `SMTP_REJECT_UNAUTHORIZED=false` exists only so a local fake SMTP server
 * (Mailpit) with a self-signed certificate works; the config loader refuses that
 * value when NODE_ENV=production.
 */
let transporter: Transporter | undefined;

export function mailTransport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
        : {}),
      tls: { rejectUnauthorized: env.SMTP_REJECT_UNAUTHORIZED },
      pool: true,
      maxConnections: 3,
      maxMessages: 50,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }
  return transporter;
}

export const mailFrom = `"${env.MAIL_FROM_NAME}" <${env.MAIL_FROM_ADDRESS}>`;

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Sends one message. Throws on failure so the caller can record the attempt. */
export async function sendMail(message: OutgoingMail): Promise<{ messageId: string }> {
  const info = await mailTransport().sendMail({
    from: mailFrom,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: {
      // Transactional mail should not be auto-replied to or bulk-filtered.
      'Auto-Submitted': 'auto-generated',
      'X-Pingexa-Mail': 'transactional',
    },
  });
  return { messageId: String(info.messageId ?? '') };
}

export async function verifySmtpConnection(): Promise<boolean> {
  try {
    await mailTransport().verify();
    return true;
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'smtp verification failed',
    );
    return false;
  }
}

export async function closeMailTransport(): Promise<void> {
  transporter?.close();
  transporter = undefined;
}
