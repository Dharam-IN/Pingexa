import { expect, test } from '@playwright/test';
import {
  TEST_PASSWORD,
  extractLinkPath,
  signIn,
  signUpAndVerify,
  uniqueEmail,
  waitForEmail,
} from './helpers';

test.describe('landing page', () => {
  test('presents the product and routes to signup', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Know your site is down');
    // No invented social proof anywhere on the page.
    await expect(page.getByText(/trusted by/i)).toHaveCount(0);
    await expect(page.getByText(/customers worldwide/i)).toHaveCount(0);

    await page.getByRole('link', { name: 'Create a free account' }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole('heading', { name: 'Create your Pingexa account' })).toBeVisible();
  });

  test('has no horizontal overflow at the tested viewport', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});

test.describe('signup, verification, login, logout', () => {
  test('walks the whole flow with a real confirmation email', async ({ page }) => {
    const email = uniqueEmail('signup');

    await page.goto('/signup');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

    // Sign in before confirming: allowed, but monitoring must be blocked.
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Confirm your email address', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add monitor' })).toHaveCount(0);

    const mail = await waitForEmail(email, /Confirm your Pingexa email address/);
    const link = extractLinkPath(mail.text, /\/verify-email\?token=[^\s]+/);
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();

    await page.getByRole('button', { name: /Go to your monitors|Sign in/ }).click();
    await expect(page.getByRole('heading', { name: 'Your monitors' })).toBeVisible();
    // The banner is gone and adding a monitor is now possible.
    await expect(page.getByText('Confirm your email address', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/(login)?$/);

    // A signed-out browser cannot reach the dashboard.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('rejects a confirmation link that has already been used', async ({ page }) => {
    const email = uniqueEmail('reuse');
    await page.goto('/signup');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

    const mail = await waitForEmail(email, /Confirm your Pingexa email address/);
    const link = extractLinkPath(mail.text, /\/verify-email\?token=[^\s]+/);

    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();

    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'That link did not work' })).toBeVisible();
  });

  test('shows field-level validation before submitting', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Enter a valid email address')).toBeVisible();
    await expect(page.getByText(/at least 10 characters/i)).toBeVisible();
    // The form did not navigate away.
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('shows one generic message for bad credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill('nobody@pingexa-e2e.local');
    await page.getByLabel('Password').fill('definitely-wrong-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That email and password do not match.')).toBeVisible();
  });
});

test.describe('password reset', () => {
  test('resets the password through the emailed link', async ({ page }) => {
    const email = uniqueEmail('reset');
    await signUpAndVerify(page, email);
    await page.getByRole('button', { name: 'Sign out' }).click();

    await page.goto('/forgot-password');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

    const mail = await waitForEmail(email, /Reset your Pingexa password/);
    const link = extractLinkPath(mail.text, /\/reset-password\?token=[^\s]+/);
    await page.goto(link);

    const newPassword = 'brand-new-e2e-pass-9';
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();

    // The old password is dead, the new one works.
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That email and password do not match.')).toBeVisible();

    await signIn(page, email, newPassword);
  });

  test('does not reveal whether an address exists', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email address').fill('definitely-not-registered@pingexa-e2e.local');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  });
});
