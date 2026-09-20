#!/usr/bin/env node
/**
 * Development mail guard.
 *
 * `npm run dev:api` and `npm run dev:worker` run this first. It refuses to
 * start a development process whose environment file points SMTP at anything
 * other than a local mail catcher.
 *
 * Why this exists. Pingexa sends real email: confirmation links, password
 * resets, and "your site is down" alerts. A developer machine often has a real
 * provider's credentials sitting in `.env` from a delivery test. Nothing else
 * in the stack distinguishes that file from a Mailpit one, so the first
 * `npm run dev:worker` after such a test would happily mail a real person from
 * a half-finished branch. That has to be impossible by default rather than
 * remembered.
 *
 * What it does NOT do:
 *   * It never reads or prints a password, an API key or a session secret. It
 *     reads exactly one key, SMTP_HOST, and prints only that.
 *   * It has no effect on production. `npm run start:api`, `start:worker`, the
 *     Docker images and every Compose stack bypass it entirely, and it exits 0
 *     immediately when NODE_ENV=production.
 *   * It is not a security control. It is a seatbelt against an accident on a
 *     laptop; `MAIL_RECIPIENT_ALLOWLIST` is the control for a run that
 *     deliberately holds live credentials (docs/DECISIONS.md D24).
 *
 * Escape hatches, in order of preference:
 *   1. Point the run at a safe file:  PINGEXA_ENV_FILE=.env.mailpit npm run dev:worker
 *   2. Say you meant it:             PINGEXA_ALLOW_EXTERNAL_SMTP=1 npm run dev:worker
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/** Hosts that cannot deliver mail to a real person. */
const LOCAL_SMTP_HOSTS = new Set([
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'localhost',
  'localhost.localdomain',
  // Compose service names for the mail catchers this repository ships.
  'mailpit',
  'pingexa-dev-mailpit',
  // Reaching the host's Mailpit from inside a container.
  'host.docker.internal',
]);

/**
 * Mirrors `resolveEnvFile()` in apps/api/src/config/env.ts. Keep the two in
 * step: a guard that inspects a different file than the one the process loads
 * is worse than no guard.
 */
function resolveEnvFile() {
  const explicit = process.env['PINGEXA_ENV_FILE'];
  if (explicit) return resolve(process.cwd(), explicit);

  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Reads one key out of a dotenv-style file. Deliberately minimal, and
 * deliberately last-occurrence-wins, because that is what dotenv does — a
 * second definition further down a file silently beats the first one.
 */
function readKey(file, key) {
  let value;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    let raw = line.slice(eq + 1).trim();
    if (
      (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) ||
      (raw.startsWith("'") && raw.endsWith("'") && raw.length > 1)
    ) {
      raw = raw.slice(1, -1);
    } else {
      // Strip an unquoted trailing comment, the way dotenv does.
      const hash = raw.indexOf(' #');
      if (hash !== -1) raw = raw.slice(0, hash).trim();
    }
    value = raw;
  }
  return value;
}

function isLocal(host) {
  const normalised = host.trim().toLowerCase().replace(/\.$/, '');
  if (LOCAL_SMTP_HOSTS.has(normalised)) return true;
  // 127.0.0.0/8 in full.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalised)) return true;
  return false;
}

function fail(lines) {
  console.error('');
  console.error('  ✖ Pingexa development mail guard');
  console.error('');
  for (const line of lines) console.error(`    ${line}`);
  console.error('');
  process.exit(1);
}

// --- run -------------------------------------------------------------------

// Production never goes through `npm run dev:*`, and nothing about production
// behaviour may depend on this file.
if (process.env['NODE_ENV'] === 'production') process.exit(0);

if (process.env['PINGEXA_ALLOW_EXTERNAL_SMTP'] === '1') {
  console.error(
    '  ! mail guard bypassed (PINGEXA_ALLOW_EXTERNAL_SMTP=1) — this run can send real email',
  );
  process.exit(0);
}

const envFile = resolveEnvFile();

if (!envFile || !existsSync(envFile)) {
  fail([
    envFile
      ? `PINGEXA_ENV_FILE points at ${envFile}, which does not exist.`
      : 'No .env file was found in this directory or any parent.',
    '',
    'Create one from the template, which points mail at Mailpit:',
    '',
    '    cp .env.example .env',
    "    node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    '    # paste that into SESSION_SECRET',
    '',
    'See docs/DEVELOPMENT.md.',
  ]);
}

const shownPath = relative(process.cwd(), envFile) || envFile;
const smtpHost = process.env['SMTP_HOST'] ?? readKey(envFile, 'SMTP_HOST');

if (!smtpHost) {
  fail([
    `SMTP_HOST is not set in ${shownPath}.`,
    '',
    'The API and the worker both require it. For local development it should',
    'be the Mailpit container from docker-compose.dev.yml:',
    '',
    '    SMTP_HOST=127.0.0.1',
    '    SMTP_PORT=58025',
  ]);
}

if (!isLocal(smtpHost)) {
  fail([
    `${shownPath} points SMTP at "${smtpHost}", which is not a local mail catcher.`,
    '',
    'A development run must not be able to send real email to a real person:',
    'confirmation links, password resets and "your site is down" alerts all go',
    'out through the worker, and a half-finished branch should not be mailing',
    'anyone.',
    '',
    'Pick one:',
    '',
    '  1. Use Mailpit (recommended). docker-compose.dev.yml already runs it:',
    '',
    '         npm run dev:up',
    '         # in your .env:',
    '         SMTP_HOST=127.0.0.1',
    '         SMTP_PORT=58025',
    '         SMTP_REJECT_UNAUTHORIZED=false',
    '',
    '     Mail then appears at http://127.0.0.1:58125 instead of a mailbox.',
    '',
    '  2. Keep that file, and run this process against a separate, safe one:',
    '',
    '         PINGEXA_ENV_FILE=.env.mailpit npm run dev:worker',
    '',
    '  3. If you really are testing delivery against a live provider, say so —',
    '     and set MAIL_RECIPIENT_ALLOWLIST to the one address you own first',
    '     (docs/DECISIONS.md D24):',
    '',
    '         PINGEXA_ALLOW_EXTERNAL_SMTP=1 npm run dev:worker',
    '',
    'See docs/DEVELOPMENT.md — "Keeping development mail local".',
  ]);
}

console.error(`  ✓ mail guard: ${shownPath} → SMTP ${smtpHost} (local mail catcher)`);
