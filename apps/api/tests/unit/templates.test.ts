import { describe, expect, it } from 'vitest';
import {
  accountAlreadyExistsMail,
  monitorDownMail,
  monitorRecoveredMail,
  passwordResetMail,
  verifyEmailMail,
  __testing,
} from '../../src/mail/templates.js';

const context = {
  monitorId: '11111111-1111-4111-8111-111111111111',
  monitorName: 'Acme site',
  monitorUrl: 'https://acme.monitored.dev/',
  at: new Date('2026-09-10T12:00:00.000Z'),
  failureReason: 'Responded with HTTP 500',
  downtimeSeconds: 930,
};

describe('email templates', () => {
  it('includes a usable verification link', () => {
    const mail = verifyEmailMail('user@monitored.dev', 'tok-123');
    expect(mail.subject).toContain('Confirm');
    expect(mail.text).toContain('/verify-email?token=tok-123');
    expect(mail.html).toContain('/verify-email?token=tok-123');
  });

  it('includes a usable reset link', () => {
    const mail = passwordResetMail('user@monitored.dev', 'tok-456');
    expect(mail.text).toContain('/reset-password?token=tok-456');
  });

  it('does not create an account in the already-exists email', () => {
    const mail = accountAlreadyExistsMail('user@monitored.dev');
    expect(mail.text).toContain('already exists');
    expect(mail.text).toContain('nothing has changed');
  });

  it('names the monitor and the reason in the down alert', () => {
    const mail = monitorDownMail('user@monitored.dev', context);
    expect(mail.subject).toBe('[Pingexa] Acme site is DOWN');
    expect(mail.text).toContain('https://acme.monitored.dev/');
    expect(mail.text).toContain('Responded with HTTP 500');
    expect(mail.text).toContain('3 consecutive failed checks');
  });

  it('reports the downtime in the recovery alert', () => {
    const mail = monitorRecoveredMail('user@monitored.dev', context);
    expect(mail.subject).toBe('[Pingexa] Acme site is back UP');
    expect(mail.text).toContain('15m 30s');
  });

  it('escapes a monitor name that contains HTML', () => {
    const mail = monitorDownMail('user@monitored.dev', {
      ...context,
      monitorName: '<img src=x onerror=alert(1)>',
    });
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;img src=x');
  });

  it('escapes a URL that contains a quote', () => {
    const mail = monitorDownMail('user@monitored.dev', {
      ...context,
      monitorUrl: 'https://x.monitored.dev/"onmouseover="alert(1)',
    });
    expect(mail.html).not.toContain('"onmouseover="');
  });

  it('formats durations readably', () => {
    expect(__testing.formatDuration(45)).toBe('45s');
    expect(__testing.formatDuration(60)).toBe('1m');
    expect(__testing.formatDuration(930)).toBe('15m 30s');
    expect(__testing.formatDuration(3600)).toBe('1h');
    expect(__testing.formatDuration(5400)).toBe('1h 30m');
  });
});
