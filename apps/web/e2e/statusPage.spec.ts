import { expect, test } from '@playwright/test';
import { addMonitor, signUpAndVerify, uniqueEmail, navigateTo } from './helpers';

const UP_URL = 'https://example.com/';
const PRIVATE_URL = 'https://example.com/pingexa-e2e-private-admin-path';

/**
 * Status page publication and, most importantly, what it does *not* show.
 *
 * The privacy assertions check the rendered HTML of a page loaded with no
 * session at all, which is the same view a stranger with the link would get.
 */
test.describe('public status page', () => {
  test('publishes selected monitors and hides everything private', async ({ page, browser }) => {
    // Signup, email confirmation, two monitors, settings, and a second browser
    // context: more steps than the default per-test budget allows.
    test.setTimeout(150_000);
    const email = uniqueEmail('statuspage');
    await signUpAndVerify(page, email);

    await addMonitor(page, 'Public marketing site', UP_URL);
    await addMonitor(page, 'Private admin panel', PRIVATE_URL);

    await navigateTo(page, 'Settings');
    await expect(page.getByRole('heading', { name: 'Public status page' })).toBeVisible();

    // Unpublished by default, and the link should not work yet.
    const linkText = await page.locator('code').first().innerText();
    expect(linkText).toMatch(/\/status\/[0-9a-f]{32}$/);
    const slugPath = new URL(linkText).pathname;

    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(slugPath);
    await expect(
      strangerPage.getByRole('heading', { name: 'Status page not available' }),
    ).toBeVisible();

    // Publish the page and select only the public monitor.
    await page.getByRole('switch', { name: 'Publish my status page' }).click();
    await expect(page.getByText('Status page published.')).toBeVisible();
    await page.getByRole('switch', { name: 'Public marketing site' }).click();
    await expect(page.getByText('Public marketing site added to your status page.')).toBeVisible();

    await strangerPage.goto(slugPath);
    await expect(strangerPage.getByText('Public marketing site')).toBeVisible();
    await expect(strangerPage.getByText('Private admin panel')).toHaveCount(0);

    // The privacy boundary, asserted against the actual rendered document.
    const html = await strangerPage.content();
    for (const secret of [
      'example.com',
      'pingexa-e2e-private-admin-path',
      email,
      'Private admin panel',
    ]) {
      expect(html, `status page leaked ${secret}`).not.toContain(secret);
    }

    // Unpublishing removes access immediately.
    await page.getByRole('switch', { name: 'Publish my status page' }).click();
    await expect(page.getByText('Status page unpublished.')).toBeVisible();
    await strangerPage.goto(slugPath);
    await expect(
      strangerPage.getByRole('heading', { name: 'Status page not available' }),
    ).toBeVisible();

    await stranger.close();
  });

  test('replacing the link breaks the old one', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await signUpAndVerify(page, uniqueEmail('rotate'));
    await addMonitor(page, 'Rotating site', UP_URL);

    await navigateTo(page, 'Settings');
    await page.getByRole('switch', { name: 'Publish my status page' }).click();
    await expect(page.getByText('Status page published.')).toBeVisible();
    await page.getByRole('switch', { name: 'Rotating site' }).click();
    await expect(page.getByText('Rotating site added to your status page.')).toBeVisible();

    const oldPath = new URL(await page.locator('code').first().innerText()).pathname;

    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(oldPath);
    await expect(strangerPage.getByText('Rotating site')).toBeVisible();

    // Replacing the link is destructive for everyone holding it, so it asks.
    await page.getByRole('button', { name: 'Replace the link' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Replace the link' }).click();
    await expect(
      page.getByText('A new link was generated. The old one stopped working immediately.'),
    ).toBeVisible();
    const newPath = new URL(await page.locator('code').first().innerText()).pathname;
    expect(newPath).not.toBe(oldPath);

    await strangerPage.goto(oldPath);
    await expect(
      strangerPage.getByRole('heading', { name: 'Status page not available' }),
    ).toBeVisible();

    await strangerPage.goto(newPath);
    await expect(strangerPage.getByText('Rotating site')).toBeVisible();

    await stranger.close();
  });

  test('an unknown slug shows the unavailable page, not an error', async ({ page }) => {
    await page.goto(`/status/${'a'.repeat(32)}`);
    await expect(page.getByRole('heading', { name: 'Status page not available' })).toBeVisible();
  });
});

test.describe('settings', () => {
  test('changes the password and keeps the current session', async ({ page }) => {
    const email = uniqueEmail('changepw');
    await signUpAndVerify(page, email);
    await navigateTo(page, 'Settings');

    await page.getByLabel('Current password').fill('e2e-password-2026');
    await page.getByLabel('New password', { exact: true }).fill('changed-e2e-pass-7');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Password changed. Other sessions have been signed out.')).toBeVisible();

    // Still signed in here: navigation still works and the app still renders.
    await navigateTo(page, 'Monitors');
  });

  test('rejects a wrong current password with a field error', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('badpw'));
    await navigateTo(page, 'Settings');

    await page.getByLabel('Current password').fill('not-the-right-one');
    await page.getByLabel('New password', { exact: true }).fill('another-e2e-pass-8');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('That is not your current password')).toBeVisible();
  });

  test('shows the account and usage facts', async ({ page }) => {
    const email = uniqueEmail('accountfacts');
    await signUpAndVerify(page, email);
    await navigateTo(page, 'Settings');
    await expect(page.getByRole('heading', { name: 'Account', level: 2 })).toBeVisible();

    // Scoped to the Account section: the shell shows the address too, and so
    // does "Monitoring and alerts", so an unscoped query is ambiguous.
    const account = page.locator('#account');
    await expect(account.getByText(email)).toBeVisible();
    await expect(account.getByText('0 of 3')).toBeVisible();
    await expect(account.getByText('Confirmed', { exact: true })).toBeVisible();
  });
});
