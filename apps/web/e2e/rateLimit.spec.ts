import { expect, test } from '@playwright/test';
import { uniqueEmail } from './helpers';

/**
 * The authentication rate limiter, exercised against the live API.
 *
 * The credential bucket is keyed on IP **and** the submitted email, so this
 * hammers one address and asserts that the allowance runs out. It also confirms
 * the two properties that make the keying worth having: a *different* address
 * from the same IP is unaffected, and the limited response is a clean JSON 429
 * rather than an HTML error page.
 */
test.describe('authentication rate limiting', () => {
  test('exhausts the per-account allowance without affecting other accounts', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const target = uniqueEmail('ratelimited');
    const bystander = uniqueEmail('bystander');

    // Prime the CSRF cookie the way a browser would.
    const primed = await request.get('/api/meta');
    expect(primed.status()).toBe(200);
    const cookies = await request.storageState();
    const csrf = cookies.cookies.find((cookie) => cookie.name === 'pingexa_csrf')?.value;
    expect(csrf, 'the API must issue a CSRF cookie on a GET').toBeTruthy();

    const attempt = (email: string) =>
      request.post('/api/auth/login', {
        data: { email, password: 'deliberately-wrong-1' },
        headers: { 'X-CSRF-Token': csrf as string, Origin: 'http://localhost:5173' },
      });

    let limited = false;
    // The configured cap is small; 40 attempts is comfortably past it without
    // being a load test.
    for (let index = 0; index < 40 && !limited; index += 1) {
      const response = await attempt(target);
      if (response.status() === 429) {
        limited = true;
        const body = (await response.json()) as { error: { code: string } };
        expect(body.error.code).toBe('rate_limited');
        expect(response.headers()['content-type']).toContain('application/json');
      } else {
        // Everything before the limit is a normal credential rejection.
        expect(response.status()).toBe(401);
      }
    }
    expect(limited, 'repeated failed logins for one address must be rate limited').toBe(true);

    // A different address from the same client still gets a real answer, so one
    // account cannot be locked out by traffic aimed at another.
    const other = await attempt(bystander);
    expect(other.status()).toBe(401);
  });
});
