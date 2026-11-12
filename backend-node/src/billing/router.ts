import { Router } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { ApiError, validateBody } from '../errors.js';
import { BillingService } from './service.js';
const planSchema = z.object({ code: z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/), name: z.string().trim().min(2).max(80), nameAr: z.string().trim().min(2).max(80),
  priceMinor: z.number().int().min(1).max(100000000).nullable(), currency: z.enum(['USD','EUR','GBP','AED','SAR']), interval: z.enum(['MONTH','YEAR']), trialDays: z.number().int().min(0).max(60), maxMembers: z.number().int().min(1).max(100000), maxWarehouses: z.number().int().min(0).max(10000), maxShops: z.number().int().min(0).max(10000) }).strict();
export function billingRouter(auth: AuthService) {
  const router = Router(), service = new BillingService(auth), { ctx, attach, origin, full, csrf } = authHttp(auth);
  router.use((_req, res, next) => { res.setHeader('Cache-Control','no-store'); next(); });
  router.use(origin, attach, full);
  router.use((req, res, next) => req.method === 'GET' ? next() : csrf(req, res, next));
  for (const name of ['businessId','planId']) router.param(name, (_req, _res, next, id) => { if (!z.string().uuid().safeParse(id).success) return next(new ApiError(400, 'INVALID_ID', 'Invalid identifier')); next(); });
  const page = (query: unknown) => { const p = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().safeParse(query); if (!p.success) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid pagination'); return p.data.page; };
  router.get('/businesses', async (_req, res) => { res.json(await service.ownerBusinesses(ctx(res))); });
  router.get('/businesses/:businessId', async (req, res) => { res.json(await service.ownerStatus(ctx(res), String(req.params.businessId))); });
  router.post('/businesses/:businessId/trial', validateBody(z.object({ planId: z.string().uuid() }).strict()), async (req, res) => { res.status(201).json(await service.startTrial(ctx(res), String(req.params.businessId), req.body.planId)); });
  router.get('/plans', async (req, res) => { res.json(await service.plans(ctx(res), page(req.query))); });
  router.post('/plans', validateBody(planSchema), async (req, res) => { res.status(201).json(await service.createPlan(ctx(res), req.body)); });
  router.put('/plans/:planId/draft',validateBody(planSchema.extend({revision:z.number().int().nonnegative()})),async(req,res)=>{const {revision,...input}=req.body;res.json(await service.updateDraft(ctx(res),String(req.params.planId),revision,input));});
  router.patch('/plans/:planId', validateBody(z.object({ revision: z.number().int().nonnegative(), published: z.boolean() }).strict()), async (req, res) => { res.json(await service.publishPlan(ctx(res), String(req.params.planId), req.body.revision, req.body.published)); });
  router.get('/audit', async (req, res) => { res.json(await service.audit(ctx(res), page(req.query))); });
  return router;
}
