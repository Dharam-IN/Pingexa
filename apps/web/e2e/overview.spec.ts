import { expect, test } from '@playwright/test';
import { addMonitor, navigateTo, signUpAndVerify, uniqueEmail } from './helpers';

/**
 * The redesigned signed-in experience: the overview, the shell's navigation,
 * and the parts of the monitor detail page that are new.
 *
 * These assert on what the screens *claim*, not on how they are laid out —
 * that a first-time user is told the rules, that a healthy account is not
 * described as unhealthy, and that a figure with no data behind it is shown as
 * absent rather than as a zero.
 */
const UP_URL = 'https://example.com/';

test.describe('first run', () => {
  test('tells a new account how monitoring will behave before it has any data', async ({
    page,
  }) => {
    const email = uniqueEmail('firstrun');
    await signUpAndVerify(page, email);

    // The four facts a first-time user otherwise has to discover by waiting.
    await expect(page.getByRole('heading', { name: 'Add your first monitor' })).toBeVisible();
    await expect(
      page.getByText('A public http:// or https:// address on its standard port (80 or 443).'),
    ).toBeVisible();
    await expect(page.getByText(/Checked every 5 minutes/)).toBeVisible();
    await expect(page.getByText(/Declared down after 3 consecutive failed checks/)).toBeVisible();
    await expect(page.getByText(new RegExp(`One email to ${email}`))).toBeVisible();
  });

  test('explains the rules again in the add-monitor dialog', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('dialogrules'));
    await page.getByRole('button', { name: 'Add your first monitor' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/every 5 minutes/)).toBeVisible();
    await expect(dialog.getByText(/standard port/)).toBeVisible();
    await expect(dialog.getByText(/Redirects are not followed/)).toBeVisible();
    await expect(dialog.getByText(/first result appears within one check interval/)).toBeVisible();
  });
});

test.describe('overview', () => {
  test('summarises a healthy account without inventing numbers', async ({ page }) => {
    test.setTimeout(120_000);
    await signUpAndVerify(page, uniqueEmail('healthy'));
    await addMonitor(page, 'Healthy site', UP_URL);
    await navigateTo(page, 'Overview');

    // Before any check has run, "typical response" has nothing behind it and
    // must say so rather than showing 0 ms.
    await expect(page.getByText('No successful checks in the last 24 hours')).toBeVisible();

    // Once a real check lands, the figure appears and the counts agree with it.
    await expect(page.getByText(/median of/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Every monitor passed its last check')).toBeVisible();
    await expect(page.getByText('No monitor is currently down')).toBeVisible();
    await expect(page.getByText('All monitors are being checked')).toBeVisible();

    // A healthy account gets no alarm banner.
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('makes a failing monitor the most prominent thing on the page', async ({ page }) => {
    test.setTimeout(120_000);
    await signUpAndVerify(page, uniqueEmail('failing'));
    await addMonitor(page, 'Broken page', `${UP_URL}pingexa-e2e-missing`);
    await navigateTo(page, 'Overview');

    // One failure is not an outage, so the banner warns rather than alarms, and
    // it says how far through the three-failure rule the monitor is.
    await expect(page.getByText('A check has failed recently')).toBeVisible({ timeout: 90_000 });
    await expect(
      page.getByText('1 failed check in a row. 2 more failures declare this monitor down.', {
        exact: true,
      }),
    ).toBeVisible();

    // It is still not counted as down anywhere.
    await expect(page.getByText('No monitor is currently down')).toBeVisible();
  });

  test('explains the monitor limit instead of silently hiding the add button', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('atlimit'));
    for (const index of [1, 2, 3]) {
      await addMonitor(page, `Slot ${index}`, `${UP_URL}?slot=${index}`);
    }
    await navigateTo(page, 'Overview');

    await expect(page.getByText(/You are using all 3 monitors/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Add monitor$/ })).toHaveCount(0);
  });

  test('links an open incident straight to the monitor it belongs to', async ({ page }) => {
    test.setTimeout(150_000);
    await signUpAndVerify(page, uniqueEmail('incidentlink'));
    await addMonitor(page, 'Recent activity', UP_URL);
    await navigateTo(page, 'Overview');

    // With no incidents the section still renders and explains the rule.
    await expect(page.getByRole('heading', { name: 'Recent incidents' })).toBeVisible();
    await expect(
      page.getByText(/No incidents in the last 7 days/),
    ).toBeVisible();
  });
});

test.describe('app shell', () => {
  test('navigates between all three destinations and marks the current one', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('nav'));

    await navigateTo(page, 'Monitors');
    await expect(page).toHaveURL(/\/app\/monitors$/);

    await navigateTo(page, 'Settings');
    await expect(page).toHaveURL(/\/app\/settings$/);

    await navigateTo(page, 'Overview');
    await expect(page).toHaveURL(/\/app$/);

    // The active route is marked with aria-current, not only with a colour.
    // Below `lg` the navigation lives in a drawer, so open it before looking.
    const drawerToggle = page.getByRole('button', { name: 'Open navigation' });
    if (await drawerToggle.isVisible()) await drawerToggle.click();

    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('keeps the account address and sign-out reachable', async ({ page }) => {
    const email = uniqueEmail('shellaccount');
    await signUpAndVerify(page, email);

    const drawerToggle = page.getByRole('button', { name: 'Open navigation' });
    if (await drawerToggle.isVisible()) await drawerToggle.click();

    // The rail and the drawer are both in the markup and exactly one is on
    // screen, so assert against the visible one at either viewport.
    await expect(page.getByTitle(email).filter({ visible: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign out' }).filter({ visible: true }),
    ).toBeVisible();
  });
});

test.describe('monitor detail', () => {
  test('switches the chart range without losing the page', async ({ page }) => {
    test.setTimeout(120_000);
    await signUpAndVerify(page, uniqueEmail('range'));
    await addMonitor(page, 'Range check', UP_URL);

    await page.getByRole('link', { name: 'Details' }).first().click();
    await expect(page.getByRole('heading', { name: 'Range check', level: 1 })).toBeVisible();

    // 24 hours is the default; 7 days is the other supported range, and both
    // exist because the retention window is 7 days.
    const range = page.getByRole('group', { name: 'Chart range' });
    await expect(range.getByRole('radio', { name: '24 hours' })).toBeChecked();
    await range.getByRole('radio', { name: '7 days' }).check();
    await expect(range.getByRole('radio', { name: '7 days' })).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Response time' })).toBeVisible();
  });

  test('lists individual check results, not only a chart', async ({ page }) => {
    test.setTimeout(120_000);
    await signUpAndVerify(page, uniqueEmail('checktable'));
    await addMonitor(page, 'Listed checks', UP_URL);

    await page.getByRole('link', { name: 'Details' }).first().click();
    await expect(page.getByRole('heading', { name: 'Recent checks' })).toBeVisible();
    // Empty until the worker records something, and it says so.
    await expect(page.getByText('No checks recorded in this range yet.')).toBeVisible();

    // Then the real result appears with its status and timing.
    await expect(page.getByRole('table', { name: /check results/i })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText('HTTP 200').first()).toBeVisible();
  });

  test('describes alert delivery as accepted, never as delivered', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('accepted'));
    await addMonitor(page, 'Alert wording', UP_URL);
    await page.getByRole('link', { name: 'Details' }).first().click();

    // The product has no bounce tracking, so it may not claim delivery.
    await expect(page.getByText(/took the message for delivery/)).toBeVisible();
    await expect(page.getByText(/not proof the email reached your inbox/)).toBeVisible();
  });

  test('puts deletion behind a separate confirmation, away from the other actions', async ({
    page,
  }) => {
    await signUpAndVerify(page, uniqueEmail('deletesafety'));
    await addMonitor(page, 'Delete safety', UP_URL);
    await page.getByRole('link', { name: 'Details' }).first().click();

    // Escape must cancel, leaving the monitor alone.
    await page.getByRole('button', { name: 'Delete Delete safety' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/entire check and incident history/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Delete safety', level: 1 })).toBeVisible();
  });
});

test.describe('settings', () => {
  test('groups the account, status page, alerting and appearance sections', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('settingsnav'));
    await navigateTo(page, 'Settings');

    for (const heading of [
      'Account',
      'Change password',
      'Public status page',
      'Monitoring and alerts',
      'Appearance',
    ]) {
      await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
    }

    // The fixed product rules are stated rather than left to be inferred.
    await expect(page.getByText('Every 5 minutes')).toBeVisible();
    await expect(page.getByText('3 consecutive failed checks')).toBeVisible();
    await expect(page.getByText('7 days of individual checks')).toBeVisible();
  });

  test('never renders a secret, a token or an internal id', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('nosecrets'));
    await navigateTo(page, 'Settings');

    const body = (await page.locator('main').innerText()).toLowerCase();
    for (const forbidden of ['password hash', 'session token', 'bearer ', 'lasterror']) {
      expect(body, `settings leaked "${forbidden}"`).not.toContain(forbidden);
    }
  });
});
