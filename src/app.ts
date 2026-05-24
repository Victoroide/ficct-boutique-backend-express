import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { config } from './config';
import { logger } from './shared/logger';
import { documentRouter } from './modules/documents/document.routes';
import { auditRouter } from './modules/audit/audit.routes';
import { errorHandler, notFoundHandler } from './middleware/error';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));
  app.use((req, _res, next) => {
    if (!req.headers['x-request-id']) {
      req.headers['x-request-id'] = randomUUID();
    }
    next();
  });
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({ requestId: req.headers['x-request-id'] }),
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('CORS not allowed'));
      },
      credentials: true,
    }),
  );
  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ficct-docs' });
  });

  app.use('/api/v1/documents', documentRouter);
  app.use('/api/v1/audit', auditRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
