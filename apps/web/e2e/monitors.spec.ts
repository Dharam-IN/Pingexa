import { expect, test } from '@playwright/test';
import { addMonitor, signUpAndVerify, uniqueEmail } from './helpers';

/**
 * Monitor management through the browser.
 *
 * The URLs here are real public addresses, because the production SSRF policy
 * refuses loopback and is deliberately not weakened for tests. `example.com`
 * answers 200 at `/` and 404 at an unknown path, which gives a genuine success
 * and a genuine failure without needing a fixture the guard would reject.
 */
const UP_URL = 'https://example.com/';
const FAILING_URL = 'https://example.com/pingexa-e2e-definitely-missing';

test.describe('monitor lifecycle', () => {
  test('adds, edits, pauses, resumes and deletes a monitor', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('monitors'));

    // Empty state first.
    await expect(page.getByRole('heading', { name: 'No monitors yet' })).toBeVisible();
    await expect(page.getByText('0 of 3 used')).toBeVisible();

    await addMonitor(page, 'Example site', UP_URL);
    await expect(page.getByText('1 of 3 used')).toBeVisible();
    // A brand new monitor has no result yet and says so rather than showing 0%.
    await expect(page.getByText('Waiting for first check')).toBeVisible();

    // Pause: the card must say so, and scheduling must stop.
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    await expect(page.getByText(/paused\./i)).toBeVisible();

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('Waiting for first check')).toBeVisible();

    // Detail page and edit.
    await page.getByRole('link', { name: 'Details' }).click();
    await expect(page.getByRole('heading', { name: 'Example site' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Response time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Incidents' })).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Name').fill('Renamed site');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Renamed site' })).toBeVisible();

    // Delete, with confirmation.
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(/Delete .Renamed site/)).toBeVisible();
    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.getByText(/Delete .Renamed site/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes, delete it' }).click();
    await expect(page.getByRole('heading', { name: 'No monitors yet' })).toBeVisible();
    await expect(page.getByText('0 of 3 used')).toBeVisible();
  });

  test('enforces the 3-monitor limit in the interface', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('limit'));

    for (const index of [1, 2, 3]) {
      await addMonitor(page, `Site ${index}`, `${UP_URL}?n=${index}`);
    }
    await expect(page.getByText('3 of 3 used')).toBeVisible();
    await expect(page.getByText('You are using all 3 monitors. Delete one to add another.')).toBeVisible();
    // No way to start a fourth.
    await expect(page.getByRole('button', { name: 'Add monitor' })).toHaveCount(0);
  });

  test('rejects a private or non-public URL with a clear message', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('ssrf'));

    await page.getByRole('button', { name: /Add (your first )?monitor/ }).first().click();
    await page.getByLabel('Name').fill('Internal');
    await page.getByLabel('URL to monitor').fill('http://169.254.169.254/latest/meta-data/');
    await page.getByRole('button', { name: 'Add monitor' }).click();

    await expect(page.getByText(/non-public address/i)).toBeVisible();
    await expect(page.getByText('0 of 3 used')).toBeVisible();
  });

  test('rejects a malformed URL in the browser before calling the API', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('badurl'));

    await page.getByRole('button', { name: /Add (your first )?monitor/ }).first().click();
    await page.getByLabel('Name').fill('Bad');
    await page.getByLabel('URL to monitor').fill('example.com');
    await page.getByRole('button', { name: 'Add monitor' }).click();
    await expect(page.getByText('Enter a full http:// or https:// URL')).toBeVisible();
  });
});

test.describe('a real check runs end to end', () => {
  test('records a successful check and shows it on the card and the chart', async ({ page }) => {
    test.setTimeout(120_000);
    await signUpAndVerify(page, uniqueEmail('realcheck'));
    await addMonitor(page, 'Live check', UP_URL);

    // The scheduler claims the monitor immediately and the worker performs a
    // real outbound request; the dashboard polls, so the card updates itself.
    await expect(page.getByText('Up', { exact: true })).toBeVisible({ timeout: 90_000 });

    await page.getByRole('link', { name: 'Details' }).click();
    await expect(page.getByText(/HTTP 200/)).toBeVisible({ timeout: 30_000 });
    // The chart has a real accessible summary, not a placeholder.
    await expect(page.getByRole('img', { name: /successful checks/ })).toBeVisible();
  });

  test('classifies a 404 as a failed check without declaring the monitor down', async ({ page }) => {
    test.setTimeout(120_000);
    await signUpAndVerify(page, uniqueEmail('failcheck'));
    await addMonitor(page, 'Missing page', FAILING_URL);

    await page.getByRole('link', { name: 'Details' }).click();
    // One failure is recorded, but three are needed before DOWN is declared.
    await expect(page.getByText(/Responded with HTTP 404/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Down', { exact: true })).toHaveCount(0);
    await expect(
      page.getByText('An incident opens after three consecutive failed checks.'),
    ).toBeVisible();
  });
});
