import { expect, test } from '@playwright/test';
import { addMonitor, openAddMonitor, signUpAndVerify, uniqueEmail } from './helpers';

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

    // Empty state first, on the management page.
    await page.goto('/app/monitors');
    await expect(page.getByRole('heading', { name: 'No monitors yet' })).toBeVisible();
    await expect(page.getByText('0 monitors of 3 in use')).toBeVisible();

    await addMonitor(page, 'Example site', UP_URL);
    await expect(page.getByText('1 monitor of 3 in use')).toBeVisible();
    // A brand new monitor has no result yet and says so rather than showing 0%.
    await expect(page.getByText('Waiting for first check').first()).toBeVisible();

    // Pause: the row must say so, and scheduling must stop.
    await page.getByRole('button', { name: 'Pause' }).first().click();
    await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/paused\./i).first()).toBeVisible();

    await page.getByRole('button', { name: 'Resume' }).first().click();
    await expect(page.getByText('Waiting for first check').first()).toBeVisible();

    // Detail page and edit.
    await page.getByRole('link', { name: 'Details' }).first().click();
    await expect(page.getByRole('heading', { name: 'Example site', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Response time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Incidents' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent checks' })).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel('Name').fill('Renamed site');
    await editDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Renamed site', level: 1 })).toBeVisible();

    // Delete, with confirmation. The dialog names what will be lost, and the
    // safe choice must actually cancel.
    await page.getByRole('button', { name: /^Delete Renamed site$/ }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm.getByText(/Delete Renamed site\?/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.getByRole('heading', { name: 'Renamed site', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: /^Delete Renamed site$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete monitor' }).click();
    await expect(page.getByRole('heading', { name: 'No monitors yet' })).toBeVisible();
    await expect(page.getByText('0 monitors of 3 in use')).toBeVisible();
  });

  test('enforces the 3-monitor limit in the interface', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('limit'));

    for (const index of [1, 2, 3]) {
      await addMonitor(page, `Site ${index}`, `${UP_URL}?n=${index}`);
    }
    await expect(page.getByText('3 monitors of 3 in use')).toBeVisible();
    await expect(page.getByText(/All 3 monitor slots are in use/)).toBeVisible();
    // No way to start a fourth, from either the list or the overview.
    await expect(page.getByRole('button', { name: /^Add monitor$/ })).toHaveCount(0);
    await page.goto('/app');
    await expect(page.getByRole('button', { name: /^Add monitor$/ })).toHaveCount(0);
  });

  test('rejects a private or non-public URL with a clear message', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('ssrf'));

    await page.goto('/app/monitors');
    await openAddMonitor(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Internal');
    await dialog.getByLabel('URL to monitor').fill('http://169.254.169.254/latest/meta-data/');
    await dialog.getByRole('button', { name: 'Add monitor' }).click();

    // The server decides this, and its message is shown verbatim.
    await expect(page.getByText(/non-public address/i)).toBeVisible();
    // The form keeps what was typed so a rejected URL is editable, not retyped.
    await expect(dialog.getByLabel('Name')).toHaveValue('Internal');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('0 monitors of 3 in use')).toBeVisible();
  });

  test('rejects a malformed URL in the browser before calling the API', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('badurl'));

    await page.goto('/app/monitors');
    await openAddMonitor(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Bad');
    // Something that cannot be repaired into a URL at all: normalisation adds a
    // scheme to a bare host, but it cannot rescue a space-separated string.
    await dialog.getByLabel('URL to monitor').fill('not a url at all');
    await dialog.getByRole('button', { name: 'Add monitor' }).click();
    await expect(page.getByText('Enter a full http:// or https:// URL')).toBeVisible();
  });

  test('normalises a bare hostname into a full URL before submitting', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('normalise'));

    await page.goto('/app/monitors');
    await openAddMonitor(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Bare host');
    await dialog.getByLabel('URL to monitor').fill('example.com');
    // The form says what it will store before it stores it.
    await expect(dialog.getByText('https://example.com')).toBeVisible();
    await dialog.getByRole('button', { name: 'Add monitor' }).click();
    await expect(page.getByRole('link', { name: 'Bare host', exact: true })).toBeVisible();
  });
});

test.describe('the monitors list', () => {
  test('searches, filters and reports how many are shown', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('listing'));
    await addMonitor(page, 'Alpha marketing', `${UP_URL}?a=1`);
    await addMonitor(page, 'Beta docs', `${UP_URL}?b=2`);

    await page.goto('/app/monitors');
    await expect(page.getByText('Showing 2 of 2 monitors')).toBeVisible();

    await page.getByLabel('Search').fill('alpha');
    await expect(page.getByText('Showing 1 of 2 monitors')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Alpha marketing', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Beta docs', exact: true })).toHaveCount(0);

    // A search that matches nothing explains itself and offers a way out.
    await page.getByLabel('Search').fill('zzzz-no-such-monitor');
    await expect(page.getByRole('heading', { name: 'No monitors match' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search and filters' }).click();
    await expect(page.getByText('Showing 2 of 2 monitors')).toBeVisible();

    // Filtering by a state nothing is in is an empty result, not an error.
    await page.getByRole('radio', { name: /^Down/ }).check();
    await expect(page.getByText('Showing 0 of 2 monitors')).toBeVisible();
  });
});

test.describe('a real check runs end to end', () => {
  test('records a successful check and shows it on the list and the chart', async ({ page }) => {
    test.setTimeout(120_000);
    await signUpAndVerify(page, uniqueEmail('realcheck'));
    await addMonitor(page, 'Live check', UP_URL);

    // The scheduler claims the monitor immediately and the worker performs a
    // real outbound request; the list polls, so the row updates itself.
    await expect(page.getByText('Up', { exact: true }).first()).toBeVisible({ timeout: 90_000 });

    await page.getByRole('link', { name: 'Details' }).first().click();
    await expect(page.getByText(/HTTP 200/).first()).toBeVisible({ timeout: 30_000 });
    // The chart has a real accessible summary, not a placeholder.
    await expect(page.getByRole('img', { name: /successful checks/ })).toBeVisible();
    // And the individual result is listed, not only plotted.
    await expect(page.getByRole('heading', { name: 'Recent checks' })).toBeVisible();
  });

  test('classifies a 404 as a failed check without declaring the monitor down', async ({ page }) => {
    test.setTimeout(120_000);
    await signUpAndVerify(page, uniqueEmail('failcheck'));
    await addMonitor(page, 'Missing page', FAILING_URL);

    await page.getByRole('link', { name: 'Details' }).first().click();
    // One failure is recorded, but three are needed before DOWN is declared.
    await expect(page.getByText(/Responded with HTTP 404/).first()).toBeVisible({ timeout: 90_000 });
    // The individual check is shown as Down — that is the check's outcome. The
    // monitor itself must not be: no down alert, and no down state badge.
    await expect(page.getByRole('heading', { name: 'This monitor is down' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText(/failed check.* in a row/)).toBeVisible();
    await expect(
      page.getByText('An incident opens after three consecutive failed checks.'),
    ).toBeVisible();
  });
});
