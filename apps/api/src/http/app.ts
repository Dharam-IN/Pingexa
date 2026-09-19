import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { monitorsRouter } from './routes/monitors.js';
import { alertsRouter, overviewRouter } from './routes/overview.js';
import { publicStatusRouter, statusPageRouter } from './routes/statusPage.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { attachSession } from './middleware/session.js';
import { cors, csrfProtection, issueCsrfCookie } from './middleware/security.js';
import './types.js';

export function createApp(): Express {
  const app = express();

  // How many reverse proxies to believe. Wrong values here let a client spoof
  // X-Forwarded-For and defeat every IP-keyed rate limit, so it is explicit
  // configuration rather than `trust proxy: true`.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.set('query parser', 'simple');

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = typeof existing === 'string' && existing.length <= 64 ? existing : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Health checks would otherwise dominate the log volume.
      autoLogging: { ignore: (req) => req.url === '/api/health' || req.url === '/api/ready' },
      serializers: {
        req: (req) => ({ method: req.method, url: req.url, id: req.id }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use((req, _res, next) => {
    req.requestId = String((req as unknown as { id?: unknown }).id ?? '');
    next();
  });

  app.use(
    helmet({
      // The API only returns JSON; a restrictive CSP here is inert but harmless,
      // and `frameguard`/`noSniff`/HSTS are the ones that matter.
      contentSecurityPolicy: { directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(cors);
  // A small body limit: every endpoint takes a handful of short fields.
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use(issueCsrfCookie);
  app.use(attachSession);

  app.use('/api', healthRouter);
  app.use('/api/public/status', publicStatusRouter);

  // Everything past this point is a private, state-changing surface.
  app.use('/api', csrfProtection);
  app.use('/api/auth', authRouter);
  app.use('/api/monitors', apiLimiter, monitorsRouter);
  // Read-only cross-monitor aggregates for the signed-in app.
  app.use('/api/overview', apiLimiter, overviewRouter);
  app.use('/api/alerts', apiLimiter, alertsRouter);
  app.use('/api/status-page', apiLimiter, statusPageRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
