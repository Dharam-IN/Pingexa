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

/**
 * Parsed once. An empty list means the allowlist is disabled, which is the
 * normal production posture.
 */
const recipientAllowlist: readonly string[] = env.MAIL_RECIPIENT_ALLOWLIST.split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter((entry) => entry.length > 0);

export function recipientAllowlistEnabled(): boolean {
  return recipientAllowlist.length > 0;
}

/**
 * Fail-closed check applied to every message immediately before the SMTP
 * transaction. When the allowlist is configured, a recipient that is not on it
 * throws rather than being silently dropped, so a test that addresses the wrong
 * account fails loudly instead of mailing a real person.
 *
 * `to` is also required to be exactly one address: `OutgoingMail` has no cc or
 * bcc field, and this keeps it that way even if a future caller passes a list
 * or a comma-joined string.
 */
export function assertRecipientAllowed(to: string): void {
  if (recipientAllowlist.length === 0) return;

  const recipients = to
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (recipients.length !== 1) {
    throw new Error(
      `Mail recipient allowlist active: expected exactly one recipient, got ${recipients.length}`,
    );
  }

  const address = (recipients[0] ?? '').toLowerCase();
  if (!recipientAllowlist.includes(address)) {
    throw new Error('Mail recipient allowlist active: recipient is not permitted');
  }
}

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface SendResult {
  readonly messageId: string;
  /**
   * The provider's final SMTP reply, e.g. `250 Ok <provider-id>`. Kept because
   * it is the only handle that ties a Pingexa send to a row in the provider's
   * own dashboard when delivery is later questioned. It is a status line, not
   * message content.
   */
  readonly response: string;
}

/** Sends one message. Throws on failure so the caller can record the attempt. */
export async function sendMail(message: OutgoingMail): Promise<SendResult> {
  assertRecipientAllowed(message.to);
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
    // With the allowlist active, pin the SMTP envelope explicitly so the
    // RCPT TO commands cannot be anything but the single permitted address.
    ...(recipientAllowlistEnabled()
      ? { envelope: { from: env.MAIL_FROM_ADDRESS, to: message.to } }
      : {}),
  });
  return {
    messageId: String(info.messageId ?? ''),
    response: String(info.response ?? ''),
  };
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
