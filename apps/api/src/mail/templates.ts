import { env } from '../config/env.js';
import type { OutgoingMail } from './transport.js';

/**
 * Plain-text-first email templates. The HTML is a light wrapper around the same
 * copy, using inline styles only, because email clients strip stylesheets.
 *
 * Every value interpolated into HTML goes through `escapeHtml`. Monitor names
 * are user input and end up in alert subjects and bodies.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BRAND = '#4f46e5';

function layout(options: {
  heading: string;
  bodyHtml: string;
  action?: { label: string; url: string };
  footerNote?: string;
}): string {
  const action = options.action
    ? `<tr><td style="padding:8px 0 24px;">
         <a href="${escapeHtml(options.action.url)}"
            style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;
                   padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px;">
           ${escapeHtml(options.action.label)}
         </a>
       </td></tr>`
    : '';

  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f4f4f7;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2330;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;
    background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e6e8ef;">
    <tr><td style="padding-bottom:20px;font-size:18px;font-weight:700;color:${BRAND};">Pingexa</td></tr>
    <tr><td style="font-size:20px;font-weight:650;padding-bottom:12px;">${escapeHtml(options.heading)}</td></tr>
    <tr><td style="font-size:15px;line-height:1.6;padding-bottom:16px;">${options.bodyHtml}</td></tr>
    ${action}
    <tr><td style="font-size:12px;line-height:1.6;color:#6b7280;border-top:1px solid #e6e8ef;padding-top:16px;">
      ${escapeHtml(options.footerNote ?? 'You are receiving this because you have a Pingexa account.')}
    </td></tr>
  </table>
</body></html>`;
}

export function verifyEmailMail(to: string, token: string): OutgoingMail {
  const url = `${env.PUBLIC_APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Confirm your Pingexa email address',
    text: [
      'Welcome to Pingexa.',
      '',
      'Confirm this email address to start monitoring your sites:',
      url,
      '',
      'The link expires in 24 hours and can be used once.',
      'If you did not create a Pingexa account, you can ignore this email.',
    ].join('\n'),
    html: layout({
      heading: 'Confirm your email address',
      bodyHtml:
        'Welcome to Pingexa. Confirm this email address to start monitoring your sites. ' +
        'Monitoring and alerts stay switched off until you do.',
      action: { label: 'Confirm email address', url },
      footerNote:
        'This link expires in 24 hours and can be used once. If you did not create a Pingexa account, ignore this email.',
    }),
  };
}

export function passwordResetMail(to: string, token: string): OutgoingMail {
  const url = `${env.PUBLIC_APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Reset your Pingexa password',
    text: [
      'Someone asked to reset the password for this Pingexa account.',
      '',
      'Choose a new password here:',
      url,
      '',
      'The link expires in 1 hour and can be used once.',
      'If this was not you, no action is needed — your password has not changed.',
    ].join('\n'),
    html: layout({
      heading: 'Reset your password',
      bodyHtml: 'Someone asked to reset the password for this Pingexa account. Choose a new one below.',
      action: { label: 'Choose a new password', url },
      footerNote:
        'This link expires in 1 hour and can be used once. If this was not you, no action is needed — your password has not changed.',
    }),
  };
}

export function passwordChangedMail(to: string): OutgoingMail {
  return {
    to,
    subject: 'Your Pingexa password was changed',
    text: [
      'The password for your Pingexa account was just changed.',
      '',
      'All other sessions have been signed out.',
      '',
      'If this was not you, reset your password immediately:',
      `${env.PUBLIC_APP_URL}/forgot-password`,
    ].join('\n'),
    html: layout({
      heading: 'Your password was changed',
      bodyHtml:
        'The password for your Pingexa account was just changed, and all other sessions have been signed out.',
      action: { label: 'Reset your password', url: `${env.PUBLIC_APP_URL}/forgot-password` },
      footerNote: 'If this was not you, reset your password immediately.',
    }),
  };
}

/**
 * Sent when someone signs up with an address that already has an account. The
 * signup endpoint answers identically for new and existing addresses so it
 * cannot be used to test whether an email is registered; this email is how the
 * real owner finds out what happened.
 */
export function accountAlreadyExistsMail(to: string): OutgoingMail {
  const loginUrl = `${env.PUBLIC_APP_URL}/login`;
  return {
    to,
    subject: 'You already have a Pingexa account',
    text: [
      'Someone tried to create a Pingexa account with this email address, but one already exists.',
      '',
      `Sign in here: ${loginUrl}`,
      '',
      `Forgot your password? ${env.PUBLIC_APP_URL}/forgot-password`,
      '',
      'No new account was created and nothing has changed.',
    ].join('\n'),
    html: layout({
      heading: 'You already have an account',
      bodyHtml:
        'Someone tried to create a Pingexa account with this email address, but one already exists. ' +
        'No new account was created and nothing has changed.',
      action: { label: 'Sign in', url: loginUrl },
      footerNote: `Forgot your password? Reset it at ${env.PUBLIC_APP_URL}/forgot-password`,
    }),
  };
}

export interface AlertContext {
  readonly monitorName: string;
  readonly monitorUrl: string;
  readonly monitorId: string;
  readonly at: Date;
  readonly failureReason?: string;
  readonly downtimeSeconds?: number;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
}

export function monitorDownMail(to: string, context: AlertContext): OutgoingMail {
  const detailUrl = `${env.PUBLIC_APP_URL}/app/monitors/${context.monitorId}`;
  const reason = context.failureReason ?? 'The site did not respond successfully.';
  return {
    to,
    subject: `[Pingexa] ${context.monitorName} is DOWN`,
    text: [
      `${context.monitorName} is down.`,
      '',
      `URL:      ${context.monitorUrl}`,
      `Detected: ${context.at.toISOString()}`,
      `Reason:   ${reason}`,
      '',
      `Pingexa confirmed this after 3 consecutive failed checks, 5 minutes apart.`,
      '',
      `Details: ${detailUrl}`,
    ].join('\n'),
    html: layout({
      heading: `${context.monitorName} is down`,
      bodyHtml:
        `<div style="padding:12px 14px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;margin-bottom:16px;">
           <strong>Reason:</strong> ${escapeHtml(reason)}
         </div>
         <div><strong>URL:</strong> ${escapeHtml(context.monitorUrl)}</div>
         <div><strong>Detected:</strong> ${escapeHtml(context.at.toISOString())}</div>
         <p style="color:#6b7280;font-size:13px;">Confirmed after 3 consecutive failed checks, 5 minutes apart.</p>`,
      action: { label: 'Open monitor', url: detailUrl },
      footerNote: 'You will get one more email from Pingexa when this monitor recovers.',
    }),
  };
}

export function monitorRecoveredMail(to: string, context: AlertContext): OutgoingMail {
  const detailUrl = `${env.PUBLIC_APP_URL}/app/monitors/${context.monitorId}`;
  const downtime =
    context.downtimeSeconds !== undefined ? formatDuration(context.downtimeSeconds) : 'unknown';
  return {
    to,
    subject: `[Pingexa] ${context.monitorName} is back UP`,
    text: [
      `${context.monitorName} is responding again.`,
      '',
      `URL:       ${context.monitorUrl}`,
      `Recovered: ${context.at.toISOString()}`,
      `Downtime:  ${downtime}`,
      '',
      `Details: ${detailUrl}`,
    ].join('\n'),
    html: layout({
      heading: `${context.monitorName} is back up`,
      bodyHtml:
        `<div style="padding:12px 14px;border-radius:8px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;margin-bottom:16px;">
           Recovered after <strong>${escapeHtml(downtime)}</strong> of downtime.
         </div>
         <div><strong>URL:</strong> ${escapeHtml(context.monitorUrl)}</div>
         <div><strong>Recovered:</strong> ${escapeHtml(context.at.toISOString())}</div>`,
      action: { label: 'Open monitor', url: detailUrl },
    }),
  };
}

export const __testing = { escapeHtml, formatDuration };
