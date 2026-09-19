import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { addMonitor, navigateTo, signOut, signUpAndVerify, uniqueEmail } from './helpers';

/**
 * Theme behaviour that only a real browser can prove: the theme applied before
 * first paint, persistence across a genuine reload, and the selector being
 * present and usable on public *and* authenticated pages at both viewport
 * sizes. The logic itself is unit-tested in `src/state/__tests__`.
 *
 * These assertions deliberately read the resolved `data-theme` attribute and
 * the painted `background-color`, not utility class names: the contract is
 * "the page is in the right theme", not "the markup contains a class".
 */

const STORAGE_KEY = 'pingexa.theme';

async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/**
 * Chooses a theme from whichever selector is on screen.
 *
 * The signed-in shell renders a rail at `lg` and up and a top bar below it, so
 * both selectors exist in the DOM and exactly one is visible. Filtering on
 * visibility picks the one a person would actually click, at either viewport.
 */
async function pickTheme(page: Page, name: 'Light' | 'Dark' | 'System'): Promise<void> {
  await page
    .getByTestId('theme-selector')
    .filter({ visible: true })
    .first()
    .getByRole('radio', { name })
    .check();
}

test.describe('theme selector', () => {
  test('is reachable on public pages and switches the whole page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('group', { name: 'Colour theme' }).first()).toBeAttached();

    await pickTheme(page, 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const dark = await bodyBackground(page);

    await pickTheme(page, 'Light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const light = await bodyBackground(page);

    // Not merely a different attribute — a different painted surface.
    expect(dark).not.toBe(light);
  });

  test('is present on every public page and the 404', async ({ page }) => {
    for (const path of ['/', '/signup', '/login', '/forgot-password', '/reset-password', '/verify-email', '/no-such-page']) {
      await page.goto(path);
      await expect(
        page.getByTestId('theme-selector').first(),
        `no theme selector on ${path}`,
      ).toBeAttached();
    }
  });

  test('is present on authenticated pages and the public status page', async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail('theme'));

    await expect(page.getByTestId('theme-selector').first()).toBeAttached();

    await navigateTo(page, 'Settings');
    await expect(page.getByRole('heading', { name: 'Public status page' })).toBeVisible();
    await expect(page.getByTestId('theme-selector').first()).toBeAttached();

    // Publish so the public status page is reachable, then check it too.
    await page.getByRole('switch', { name: 'Publish my status page' }).click();
    await expect(page.getByText('Status page published.')).toBeVisible();
    const statusPath = new URL(await page.locator('code').first().innerText()).pathname;

    await page.goto(statusPath);
    await expect(page.getByTestId('theme-selector').first()).toBeAttached();
  });
});

test.describe('persistence', () => {
  test('survives navigation, reload, logout, and a later visit', async ({ page, context }) => {
    await signUpAndVerify(page, uniqueEmail('themepersist'));
    await pickTheme(page, 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBe('dark');

    await navigateTo(page, 'Settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await signOut(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // A new tab in the same browser profile is a subsequent visit.
    const later = await context.newPage();
    await later.goto('/');
    await expect(later.locator('html')).toHaveAttribute('data-theme', 'dark');
    await later.close();
  });

  test('an explicit choice beats a contrary OS setting', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await pickTheme(page, 'Light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.reload();
    // Still light, even though the OS says dark.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

test.describe('system mode', () => {
  test('is the default, and stores nothing until a choice is made', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  });

  test('follows the OS while selected, in both directions', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('resumes following the OS after being re-selected', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await pickTheme(page, 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await pickTheme(page, 'System');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('initial load', () => {
  test('applies the stored theme before the first paint', async ({ page }) => {
    // Record the resolved theme at the earliest moment a script can observe it.
    await page.addInitScript((key) => {
      window.localStorage.setItem(key, 'dark');
      (window as unknown as { __earlyTheme?: string | null }).__earlyTheme = null;
      document.addEventListener('readystatechange', () => {
        const w = window as unknown as { __earlyTheme?: string | null };
        if (w.__earlyTheme === null) {
          w.__earlyTheme = document.documentElement.getAttribute('data-theme');
        }
      });
    }, STORAGE_KEY);

    await page.goto('/');
    const early = await page.evaluate(
      () => (window as unknown as { __earlyTheme?: string | null }).__earlyTheme,
    );
    // Dark from the very first observable moment: no flash of light.
    expect(early).toBe('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('applies a dark OS preference before the first paint', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => {
      (window as unknown as { __earlyTheme?: string | null }).__earlyTheme = null;
      document.addEventListener('readystatechange', () => {
        const w = window as unknown as { __earlyTheme?: string | null };
        if (w.__earlyTheme === null) {
          w.__earlyTheme = document.documentElement.getAttribute('data-theme');
        }
      });
    });
    await page.goto('/');
    expect(
      await page.evaluate(
        () => (window as unknown as { __earlyTheme?: string | null }).__earlyTheme,
      ),
    ).toBe('dark');
  });
});

test.describe('both themes render the app', () => {
  test('overview, monitor detail and chart adapt', async ({ page }) => {
    test.setTimeout(120_000);
    await signUpAndVerify(page, uniqueEmail('themechart'));
    await addMonitor(page, 'Theme check', 'https://example.com/');

    // A chart needs at least one recorded check, so wait for the worker to
    // perform a real one rather than asserting against the empty state.
    await expect(page.getByText('Up', { exact: true }).first()).toBeVisible({ timeout: 90_000 });

    await page.getByRole('link', { name: 'Details' }).first().click();
    await expect(page.getByRole('heading', { name: 'Response time' })).toBeVisible();
    await expect(page.locator('.recharts-cartesian-grid line').first()).toBeAttached({
      timeout: 30_000,
    });

    const gridStroke = async () =>
      page.evaluate(() => {
        const line = document.querySelector('.recharts-cartesian-grid line');
        return line ? getComputedStyle(line).stroke : null;
      });

    await pickTheme(page, 'Light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const lightGrid = await gridStroke();

    await pickTheme(page, 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkGrid = await gridStroke();

    // The chart is drawn from theme tokens, so its grid must differ.
    expect(lightGrid).toBeTruthy();
    expect(darkGrid).toBeTruthy();
    expect(lightGrid).not.toBe(darkGrid);
  });

  test('the focus ring is visible on the selector in both themes', async ({ page }) => {
    for (const theme of ['Light', 'Dark'] as const) {
      await page.goto('/login');
      await pickTheme(page, theme);
      // Reach it by keyboard so :focus-visible genuinely applies.
      for (let i = 0; i < 20; i += 1) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(
          () => !!document.activeElement?.closest('[data-testid="theme-selector"]'),
        );
        if (inside) break;
      }
      const outline = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement as Element);
        return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
      });
      expect(outline.style, `${theme}: no focus outline style`).not.toBe('none');
      expect(outline.width, `${theme}: focus outline too thin`).toBeGreaterThanOrEqual(1);
    }
  });
});
