import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import { config, clientDistDir } from './config.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler, limiter } from './middleware/http.js';
import { createEmbeddedStatic } from './clientAssets.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin(origin, cb) {
        // Allow same-origin / non-browser clients and configured dev origins.
        if (!origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      },
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );

  app.use(compression());
  // Request bodies are tiny (resolve payloads); anything larger is rejected.
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(limiter(config.rateLimit.apiPerMin, 'api'));

  // Baseline security headers (API + static frontend).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.use('/api', apiRouter());

  // Serve the built frontend: from the embedded bag (packaged binary) or
  // from disk when running out of a checkout.
  const embedded = createEmbeddedStatic();
  if (embedded) {
    app.use(embedded);
  } else {
    const dist = clientDistDir();
    if (dist) {
      app.use(
        express.static(dist, {
          index: false,
          maxAge: '1h',
          setHeaders(res, filePath) {
            if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
          },
        }),
      );
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(dist, 'index.html'));
      });
    }
  }

  app.use('/api', notFoundHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
