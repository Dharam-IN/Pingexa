import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Mailpit's REST API stands in for a real inbox. Reading the verification link
 * out of the delivered message is the only way to test the signup flow the way
 * a person experiences it.
 */
const MAILPIT = process.env['E2E_MAILPIT_URL'] ?? 'http://127.0.0.1:58125';

export function uniqueEmail(prefix: string): string {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${suffix}@pingexa-e2e.local`;
}

export const TEST_PASSWORD = 'e2e-password-2026';

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

async function listMessages(): Promise<MailpitMessage[]> {
  const response = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
  if (!response.ok) throw new Error(`Mailpit is not reachable at ${MAILPIT}`);
  const body = (await response.json()) as { messages: MailpitMessage[] };
  return body.messages;
}

async function messageText(id: string): Promise<string> {
  const response = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  const body = (await response.json()) as { Text: string };
  return body.Text;
}

/** Waits for a message to arrive for `address` whose subject matches. */
export async function waitForEmail(
  address: string,
  subjectPattern: RegExp,
  timeoutMs = 25_000,
): Promise<{ id: string; subject: string; text: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await listMessages();
    const match = messages.find(
      (message) =>
        message.To.some((to) => to.Address.toLowerCase() === address.toLowerCase()) &&
        subjectPattern.test(message.Subject),
    );
    if (match) {
      return { id: match.ID, subject: match.Subject, text: await messageText(match.ID) };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email matching ${subjectPattern} for ${address} within ${timeoutMs}ms`);
}

export function extractLinkPath(text: string, pathPattern: RegExp): string {
  const match = text.match(pathPattern);
  if (!match) throw new Error(`No link matching ${pathPattern} in the email body`);
  return match[0];
}

/** Signs up, reads the confirmation email, confirms it, and signs in. */
export async function signUpAndVerify(
  page: Page,
  email: string,
  password = TEST_PASSWORD,
): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

  const mail = await waitForEmail(email, /Confirm your Pingexa email address/);
  const link = extractLinkPath(mail.text, /\/verify-email\?token=[^\s]+/);
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();

  await signIn(page, email, password);
}

export async function signIn(page: Page, email: string, password = TEST_PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your monitors' })).toBeVisible();
}

export async function addMonitor(page: Page, name: string, url: string): Promise<void> {
  await page.getByRole('button', { name: /Add (your first )?monitor/ }).first().click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('URL to monitor').fill(url);
  await page.getByRole('button', { name: 'Add monitor' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
