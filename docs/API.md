# Pingexa API

Base path: `/api`. All request and response bodies are JSON.

The web client imports the request schemas and response types from
`@pingexa/shared`, so this document and the code cannot drift: the shapes below
are the shapes in `packages/shared/src/schemas.ts` and
`packages/shared/src/api.ts`.

## Authentication model

* A successful `POST /api/auth/login` sets two cookies:
  * `pingexa_session` — httpOnly, `SameSite` per `COOKIE_SAMESITE` (default
    `Lax`), `Secure` per `COOKIE_SECURE`. The value is 32 random bytes; the
    server stores only an HMAC of it.
  * `pingexa_csrf` — **not** httpOnly, deliberately, because the client must
    read it.
* Every request must be sent with credentials (`fetch(..., { credentials: 'include' })`).
* Every non-GET request must send `X-CSRF-Token` with the exact value of the
  `pingexa_csrf` cookie, and its `Origin` (when the browser sends one) must be
  listed in `TRUSTED_ORIGINS`. Otherwise the API answers `403`
  (`csrf_failed` / `origin_not_allowed`).
* Any GET issues the CSRF cookie if it is missing, so a client can prime itself
  with `GET /api/meta`.

## Error format

Every non-2xx response has this body:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Some of the details you entered need fixing.",
    "fields": { "email": "Enter a valid email address" }
  }
}
```

`code` is stable and safe to branch on. `message` is safe to show a user.
`fields` is present only for per-field validation problems and is keyed by the
dotted field path. Unexpected server errors always return
`{"error":{"code":"internal_error","message":"Something went wrong on our side."}}`
with no internal detail.

Common codes: `validation_failed` (400), `invalid_monitor_url` (400),
`invalid_token` (400), `invalid_credentials` (400/401), `unauthenticated` (401),
`forbidden` (403), `csrf_failed` (403), `origin_not_allowed` (403),
`not_found` (404), `monitor_limit_reached` (409), `rate_limited` (429),
`internal_error` (500).

Requesting another user's resource returns `404 not_found`, never `403`, so an
id cannot be probed for existence.

## Health and metadata

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | none | Liveness. Always 200 while the process is up. Touches no dependency. |
| GET | `/api/ready` | none | Readiness. 200 when Postgres **and** Redis answer, 503 otherwise. |
| GET | `/api/meta` | none | The product's fixed rules, so the client never hardcodes them. |

`GET /api/health` → `{ "status": "ok", "service": "pingexa-api", "version": "1.0.0", "uptimeSeconds": 42 }`

`GET /api/ready` → `{ "status": "ready", "checks": { "database": true, "redis": true } }`

`GET /api/meta` → `{ "monitorLimit": 3, "intervalSeconds": 300, "failureThreshold": 3, "checkRetentionDays": 7, "minPasswordLength": 10 }`

## Authentication

| Method | Path | Auth | Success |
|---|---|---|---|
| POST | `/api/auth/signup` | none | 202 |
| POST | `/api/auth/login` | none | 200 |
| POST | `/api/auth/logout` | session (optional) | 204 |
| GET | `/api/auth/me` | session | 200 |
| POST | `/api/auth/verify-email` | none | 200 |
| POST | `/api/auth/verify-email/resend` | none | 202 |
| POST | `/api/auth/password-reset/request` | none | 202 |
| POST | `/api/auth/password-reset/confirm` | none | 200 |
| POST | `/api/auth/password` | session | 200 |

### POST /api/auth/signup
Body: `{ "email": string, "password": string }`.
Password rules: at least 10 characters, at least one letter and one digit.

Always answers `202 { "status": "verification_sent", "message": "..." }`, whether
or not the address already has an account. A new address gets a confirmation
email; an existing one gets an "you already have an account" email instead. No
session is created — verification comes first.

### POST /api/auth/login
Body: `{ "email": string, "password": string }`.
`200 { "user": SessionUser }` and sets the session and CSRF cookies.
`401 invalid_credentials` with an identical message for a wrong password and an
unknown address.

An **unverified** account can sign in (so it can request a new link) but every
monitor write returns `403 forbidden`.

### GET /api/auth/me
`200 { "user": { "id", "email", "emailVerified", "createdAt" } }`, or `401`.

### POST /api/auth/verify-email
Body: `{ "token": string }`. `200 { "status": "verified" | "already_verified", "monitorsActivated": number }`.
Single use, expires 24 hours after issue. Verifying also schedules any monitors
the account created while unverified.

### POST /api/auth/verify-email/resend
Body: `{ "email": string }`. Always `202 { "status": "verification_sent" }`.
Issuing a new token invalidates the previous one.

### POST /api/auth/password-reset/request
Body: `{ "email": string }`. Always `202 { "status": "reset_email_sent" }`.

### POST /api/auth/password-reset/confirm
Body: `{ "token": string, "password": string }`. `200 { "status": "password_reset" }`.
Single use, expires 1 hour after issue. Completing a reset **revokes every
session** for the account and marks the email verified (receiving the link proves
control of the mailbox).

### POST /api/auth/password
Body: `{ "currentPassword": string, "newPassword": string }`. `200 { "status": "password_changed" }`.
Revokes every session **except** the calling one.

## Monitors

All require a session. Writes additionally require a verified email.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/monitors` | List with 24h uptime per monitor. |
| POST | `/api/monitors` | Create. 409 `monitor_limit_reached` past 3. |
| GET | `/api/monitors/:id` | Detail: uptime, checks, incidents, alert history. |
| GET | `/api/monitors/:id/checks?window=24h\|7d` | Raw check rows. |
| GET | `/api/monitors/:id/incidents` | Up to 100 incidents, newest first. |
| PATCH | `/api/monitors/:id` | Any of `name`, `url`, `paused`, `isPublic`. |
| DELETE | `/api/monitors/:id` | 204. Cascades checks, incidents, alerts. |

### POST /api/monitors
Body: `{ "name": string (1-60), "url": string, "isPublic"?: boolean }`.

The URL must pass the SSRF guard, which is applied **before** anything is
stored: `http:`/`https:` only, no credentials in the URL, standard port only
(80/443), no internal-only hostname suffix, and every resolved A/AAAA record must
be a globally routable unicast address. A rejection is
`400 invalid_monitor_url` with a human message in both `message` and
`fields.url`.

`201 { "monitor": MonitorSummary }`. A new monitor starts `state: "PENDING"`.

### PATCH /api/monitors/:id
At least one field is required (`400 validation_failed` otherwise). Three edits
have side effects:

* **`url` changed** — the failure streak resets, `state` returns to `PENDING`,
  and an open incident is closed with `closeReason: "MONITOR_RECONFIGURED"`.
  No recovery email is sent: nothing recovered.
* **`paused: true`** — `nextCheckAt` becomes `null` (no further checks or
  alerts) and an open incident is closed with `closeReason: "MONITOR_PAUSED"`.
  No recovery email.
* **`paused: false`** — an immediate check is scheduled and `state` returns to
  `PENDING`, because the state while paused is unknown.

### MonitorSummary

```ts
{
  id: string;
  name: string;
  url: string;
  state: 'PENDING' | 'UP' | 'DOWN';          // stored
  displayState: 'PENDING'|'UP'|'DOWN'|'PAUSED'|'STALE';  // derived, for display
  paused: boolean;
  isPublic: boolean;
  intervalSeconds: number;                    // always 300 in production
  consecutiveFailures: number;
  monitoringStale: boolean;                   // checks stopped arriving
  lastCheckedAt: string | null;               // ISO 8601
  lastResponseTimeMs: number | null;
  lastStatusCode: number | null;
  lastFailureKind: FailureKind | null;
  lastFailureReason: string | null;
  nextCheckAt: string | null;
  createdAt: string;
  updatedAt: string;
  uptime24h: UptimeSummary;
  openIncidentId: string | null;
}
```

`state` is what is stored; `displayState` is what to render. `PAUSED` and
`STALE` exist only in `displayState` — a paused monitor keeps its last `state`,
and `STALE` means the real state is unknown.

### UptimeSummary

```ts
{
  window: '24h' | '7d';
  windowStart: string; windowEnd: string;
  upChecks: number; downChecks: number;
  recordedChecks: number;      // up + down
  expectedChecks: number;      // implied by the interval since max(createdAt, windowStart)
  uptimePercent: number | null;  // up / (up + down); null when nothing was recorded
  coveragePercent: number;       // recorded / expected
  partialData: boolean;          // coverage < 90%
}
```

`uptimePercent` counts only checks that actually ran, so a monitoring gap is
never counted as uptime **or** as downtime. `coveragePercent` is how that gap is
made visible. `null` (not `0` or `100`) means "no data yet".

### CheckRecord

```ts
{
  id: string;
  scheduledFor: string;   // the 5-minute slot this check belongs to
  checkedAt: string;      // when the result was obtained
  outcome: 'UP' | 'DOWN';
  statusCode: number | null;
  responseTimeMs: number | null;  // time to response headers; null on failure
  failureKind: FailureKind | null;
  failureReason: string | null;   // short, safe; never a response body
}
```

`FailureKind` is one of `HTTP_ERROR`, `REDIRECT`, `TIMEOUT`, `DNS_ERROR`,
`CONNECTION_ERROR`, `TLS_ERROR`, `BLOCKED_ADDRESS`, `INVALID_URL`,
`RESPONSE_TOO_LARGE`, `UNKNOWN_ERROR`.

### IncidentRecord

```ts
{
  id: string;
  startedAt: string;    // checkedAt of the FIRST failed check in the streak
  detectedAt: string;   // checkedAt of the THIRD failure — when the alert was raised
  resolvedAt: string | null;  // checkedAt of the FIRST success after the outage
  durationSeconds: number;    // resolvedAt - startedAt, or now - startedAt while open
  ongoing: boolean;
  closeReason: 'RECOVERED' | 'MONITOR_RECONFIGURED' | 'MONITOR_PAUSED' | null;
  causeKind: FailureKind | null;
  causeReason: string | null;
}
```

Only `closeReason: "RECOVERED"` produced a recovery email.

### NotificationRecord

```ts
{ id, incidentId, kind: 'DOWN' | 'RECOVERY', status: 'PENDING' | 'SENT' | 'FAILED', attempts, sentAt, createdAt }
```

At most one `DOWN` and one `RECOVERY` per incident, enforced by a unique index.

## Status page (owner)

All require a session.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/status-page` | Creates the page on first read, unpublished. |
| PATCH | `/api/status-page` | `{ "title"?: string, "published"?: boolean }` |
| POST | `/api/status-page/rotate-slug` | Issues a new slug; the old link stops working. |

All three return `{ "statusPage": { slug, title, published, publicUrl, publishedMonitorIds, createdAt, updatedAt } }`.

Which monitors appear is controlled per monitor via
`PATCH /api/monitors/:id { "isPublic": boolean }`.

## Public status page

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/public/status/:slug` | none | 404 for an unknown slug, an unpublished page, or a malformed slug. |

`Cache-Control: public, max-age=30`. Response:

```ts
{
  title: string;
  generatedAt: string;
  overall: 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
  intervalSeconds: number;
  monitors: Array<{
    id: string;
    name: string;
    displayState: MonitorDisplayState;
    lastCheckedAt: string | null;
    uptime24h: UptimeSummary;
    uptime7d: UptimeSummary;
    recentIncidents: Array<{ id, startedAt, resolvedAt, durationSeconds, ongoing }>;
  }>;
}
```

This projection is built by a single function (`serialisePublicMonitor`) that
never receives or emits the monitored URL, the owner's email, HTTP status codes,
failure reasons, or the slug. Only monitors with `isPublic: true` are included,
and only while the page itself is published.

## Rate limits

Backed by Redis so limits hold across API instances. A limited request returns
`429 rate_limited`. `RateLimit-*` response headers follow draft-7.

| Bucket | Key | Default |
|---|---|---|
| Credential endpoints (signup, login, resend, reset request, password change) | IP + submitted email | 15 / 15 min |
| Token redemption (verify-email, reset confirm) | IP | 60 / 15 min |
| Authenticated API | user id (falls back to IP) | 300 / min |
| Monitor writes | user id | 20 / min |
| Public status pages | IP | 60 / min |

Credential endpoints are keyed on IP **and** email so a password spray is
limited per account without one IP being able to lock an account out. Token
redemption gets its own looser bucket: those requests carry no email, and a
token is 256 bits of randomness, so the limit is about volume, not guessing.

If Redis is unavailable the limiter allows the request rather than failing it,
and logs that it did.

## Outbound check semantics

What Pingexa sends to a monitored site, and how the answer is graded:

* `GET` only, over HTTP/1.1, one connection per check.
* Exactly these headers: `user-agent` (`MONITOR_USER_AGENT`), `accept: */*`,
  `accept-encoding: identity`, `cache-control: no-cache`, `connection: close`,
  plus `host`. No cookies, no authorization, no user-supplied headers.
* TLS certificates are always verified. There is no configuration that disables
  this.
* Redirects are **not** followed.

| Result | Outcome | `failureKind` |
|---|---|---|
| `2xx` | UP | — |
| `3xx` | DOWN | `REDIRECT` |
| `4xx`, `5xx` | DOWN | `HTTP_ERROR` |
| No response within `MONITOR_TIMEOUT_MS` | DOWN | `TIMEOUT` |
| DNS lookup failed | DOWN | `DNS_ERROR` |
| TCP connect/reset failed | DOWN | `CONNECTION_ERROR` |
| Certificate or handshake failed | DOWN | `TLS_ERROR` |
| Resolved to a non-public address | DOWN | `BLOCKED_ADDRESS` |
| URL no longer passes the shape rules | DOWN | `INVALID_URL` |
| Body exceeded `MONITOR_MAX_RESPONSE_BYTES` | DOWN | `RESPONSE_TOO_LARGE` |

`responseTimeMs` is the time to response **headers** (time to first byte), which
is the figure an uptime check is about. The body is read only to enforce the size
cap and is then discarded; nothing from it is stored or logged.
