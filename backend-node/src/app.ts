import { approvalRouter } from './billing/approvals.js';
import { supportRouter } from './support/router.js';
import { platformBillingRouter } from './platform/billing.js';
import { imageRouter } from './catalogue/image-router.js';
import { completionRouter } from './workflows/router.js';
import { salesRouter } from './sales/router.js';
import { transferRouter } from './transfers/router.js';
import { operationsRouter } from './operations/router.js';
import {requestBudget} from './request-budget.js';
import {authHttp} from './auth/http.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import { paypalRouter } from './billing/paypal/router.js';
import type { PayPalProvider } from './billing/paypal/client.js';
import { billingRouter } from './billing/router.js';
import { platformRouter } from './platform/router.js';
import { businessRouter } from './businesses/router.js';
import { locationRouter } from './locations/router.js';
import { catalogueRouter } from './catalogue/router.js';
import { productImportRouter } from './catalogue/import-router.js';
import { authRouter } from './auth/router.js';
import type { AuthService } from './auth/service.js';
import { ApiError, errorHandler } from './errors.js';
export type DatabaseProbe = () => Promise<void>;
export function createApp(config: Pick<Config, 'CORS_ORIGINS'> & Partial<Pick<Config,'TRUST_PROXY_IP'>>, logger: Logger, databaseProbe: DatabaseProbe, auth?: AuthService, paypal?: PayPalProvider) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy',config.TRUST_PROXY_IP?[config.TRUST_PROXY_IP]:false);
  app.use((_req, res, next) => {
    const start = performance.now();
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId);
    res.on('finish', () => logger.info({ requestId: res.locals.requestId, method: _req.method,
      status: res.statusCode, durationMs: Math.round(performance.now() - start) }, 'Request completed'));
    next();
  });
  app.use(helmet());
  app.use(cors({ credentials: true, origin(origin, cb) {
    if (!origin || config.CORS_ORIGINS.includes(origin)) return cb(null, true);
    cb(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed'));
  } }));
  app.use('/api', requestBudget());
  if(auth){
    const http=authHttp(auth);
    app.use(async(req,res,next)=>{
      const heavy=req.path.startsWith('/api/')&&(/\/(reports|insights|product-imports)(\/|$)/.test(req.path)||req.query.export==='true');
      if(!heavy)return next();
      const token=http.getToken(req);
      if(!token)throw new ApiError(401,'UNAUTHENTICATED','Sign in first');
      const context=await auth.authenticate(token);
      try{await auth.limit('heavy-api-user',context.user.id,30,60);}
      catch(error){res.setHeader('Retry-After','60');throw error;}
      next();
    });
  }

  // The larger upload allowance is authenticated and scoped to product imports.
  if(auth)app.use('/api/businesses/:businessId/product-imports',productImportRouter(auth));
  if(auth)app.use('/api/businesses/:businessId/products/:productId/image',imageRouter(auth));
  app.use(express.json({ limit: '100kb' }));
  app.get('/api/health/live', (_req, res) => { res.json({ status: 'ok' }); });
  app.get('/api/health/ready', async (_req, res) => {
    try { await databaseProbe(); }
    catch { throw new ApiError(503, 'NOT_READY', 'Service is not ready'); }
    res.json({ status: 'ready' });
  });
  if (auth) {
    app.use('/api/auth', authRouter(auth));
    app.use('/api/businesses/:businessId/products', catalogueRouter(auth));
    app.use('/api/businesses/:businessId/locations', locationRouter(auth));
    app.use('/api/businesses/:businessId/operations', operationsRouter(auth));
    app.use('/api/businesses/:businessId/workflows', completionRouter(auth));
    app.use('/api/businesses/:businessId/sales', salesRouter(auth));
    app.use('/api/businesses/:businessId/transfers', transferRouter(auth));
    app.use('/api/businesses', businessRouter(auth));
    app.use('/api/platform', platformBillingRouter(auth,paypal?.scope));
    app.use('/api/platform', platformRouter(auth));
    app.use('/api/support', supportRouter(auth));
    app.use('/api/billing', paypalRouter(auth, paypal));
    app.use('/api/billing', approvalRouter(auth));
    app.use('/api/billing', billingRouter(auth));
  }
  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Route not found')));
  app.use(errorHandler(logger));
  return app;
}
