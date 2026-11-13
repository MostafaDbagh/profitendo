import { Router } from 'express';
import { z } from 'zod';
import { authHttp } from '../auth/http.js';
import type { AuthService } from '../auth/service.js';
import { ApiError, validateBody } from '../errors.js';
import {policyKey,policySchema} from '../auth/policy.js';
import {requirePlatform} from './service.js';
import { PlatformService } from './service.js';
const paging = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const query = paging.extend({ q: z.string().trim().max(100).default(''), status: z.enum(['all', 'active', 'inactive']).default('all') }).strict();
const patch = z.object({ revision: z.number().int().nonnegative(), active: z.boolean(), reason: z.string().trim().min(5).max(500) }).strict();
export function platformRouter(auth: AuthService) {
  const router = Router(), service = new PlatformService(auth);
  const { ctx, attach, full, origin, csrf } = authHttp(auth);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(origin, attach, full);
  router.use((req, res, next) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? csrf(req, res, next) : next());
  router.param('id', (_req, _res, next, id) => { if (!z.string().uuid().safeParse(id).success) return next(new ApiError(400, 'INVALID_ID', 'Invalid identifier')); next(); });
  const parse = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> => { const result = schema.safeParse(value); if (!result.success) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid query'); return result.data; };
  router.get('/onboarding-policy',async(_req,res)=>res.json(await auth.transaction(async tx=>{await requirePlatform(auth,tx,ctx(res));return auth.policy(tx);})));
  router.patch('/onboarding-policy',validateBody(policySchema),async(req,res)=>res.json(await auth.transaction(async tx=>{
    const {user}=await requirePlatform(auth,tx,ctx(res));
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(7193021)`;
    const before=await auth.policy(tx);
    if(before.revision!==req.body.revision)throw new ApiError(409,'REVISION_CONFLICT','Reload settings before saving');
    const after={...req.body,revision:before.revision+1};
    await tx.systemMetadata.upsert({where:{key:policyKey},create:{key:policyKey,value:JSON.stringify(after)},update:{value:JSON.stringify(after)}});
    for(const key of ['emailRequired','ownerPhoneRequired','welcomeEnabled'] as const)if(before[key]!==after[key])await tx.platformAudit.create({data:{actorId:user.id,targetId:user.id,targetType:'onboarding-policy',action:`onboarding.${key}`,reason:'Super Admin updated onboarding settings',beforeActive:before[key],afterActive:after[key]}});
    return after;
  })));
  router.get('/overview', async (_req, res) => { res.json(await service.overview(ctx(res))); });
  router.get('/businesses', async (req, res) => { res.json(await service.businesses(ctx(res), parse(query, req.query))); });
  router.get('/users', async (req, res) => { res.json(await service.users(ctx(res), parse(query, req.query))); });
  router.get('/audit', async (req, res) => { res.json(await service.audit(ctx(res), parse(paging.strict(), req.query))); });
  router.patch('/businesses/:id/status', validateBody(patch), async (req, res) => { res.json(await service.setBusinessStatus(ctx(res), String(req.params.id), req.body)); });
  router.patch('/users/:id/status', validateBody(patch), async (req, res) => { res.json(await service.setUserStatus(ctx(res), String(req.params.id), req.body)); });
  return router;
}
