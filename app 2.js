import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { sessionMiddleware } from './middleware/session.js';
import { attachUser } from './middleware/auth.js';
import { csrfProtection, csrfTokenHandler } from './middleware/csrf.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';
import { webhooksRouter } from './routes/webhooks.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { publicRouter } from './routes/public.routes.js';
import { requestsRouter } from './routes/requests.routes.js';
import { quotesRouter } from './routes/quotes.routes.js';
import { projectsRouter } from './routes/projects.routes.js';
import { paymentsRouter } from './routes/payments.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { pool } from './db/pool.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();

  // Render (and most hosts) sit behind a proxy. Needed for secure cookies
  // and correct client IPs in rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          // The pay button sends the customer to Stripe's hosted page.
          formAction: ["'self'", 'https://checkout.stripe.com'],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          upgradeInsecureRequests: config.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'same-origin' },
    })
  );

  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // The Stripe webhook needs the raw request body for signature verification,
  // so it is mounted before the JSON parser and outside CSRF protection.
  app.use('/api/webhooks', webhooksRouter);

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests. Slow down and try again shortly.' },
    })
  );

  app.use(sessionMiddleware);
  app.use(attachUser);
  app.use(csrfProtection);

  app.get('/api/csrf', csrfTokenHandler);
  app.use('/api/auth', authRouter);
  app.use('/api', publicRouter);
  app.use('/api/project-requests', requestsRouter);
  app.use('/api/quotes', quotesRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/admin', adminRouter);

  app.use(
    express.static(publicDir, {
      extensions: ['html'],       // /services -> /services.html
      maxAge: config.isProduction ? '1h' : 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );

  app.use(notFoundHandler);
  app.use((_req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));
  app.use(errorHandler);

  return app;
}
