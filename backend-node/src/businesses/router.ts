import { Router } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { invite } from '../auth/invitations.js';
import { ApiError, validateBody } from '../errors.js';
import { permissionKeys, PERMISSIONS, staffRoles } from './permissions.js';
import { BusinessService } from './service.js';
const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict();
const currency = z.enum(['USD','EUR','GBP','SAR','AED','EGP','SYP','JOD','IQD','LBP','KWD','QAR','BHD','OMR','YER','TRY']);
const businessPatch = z.object({
  revision: z.number().int().nonnegative(), name: z.string().trim().min(2).max(120).optional(), baseCurrency: currency.optional(),
  timezone: z.string().max(80).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }).optional(),
  dateFormat: z.enum(['dmy','mdy','ymd']).optional(), numberFormat: z.enum(['western','european','arabic']).optional(),
}).strict().refine(v => Object.keys(v).length > 1);
const overrides = z.record(z.string(), z.boolean()).refine(values => Object.keys(values).every(k => permissionKeys.includes(k as typeof permissionKeys[number]) && !PERMISSIONS[k as typeof permissionKeys[number]].ownerOnly));
const memberPatch = z.object({ revision: z.number().int().nonnegative(), role: z.enum(staffRoles).optional(), permissionOverrides: overrides.optional(), active: z.boolean().optional() }).strict().refine(v => Object.keys(v).length > 1);
export function businessRouter(auth: AuthService) {
  const router = Router(), service = new BusinessService(auth);
  const { ctx, attach, csrf, full, origin } = authHttp(auth);
  router.use(origin, attach, full);
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return csrf(req, res, next);
    next();
  });
  router.param('businessId', (_req, _res, next, value) => { if (!z.string().uuid().safeParse(value).success) return next(new ApiError(400, 'INVALID_ID', 'Invalid business identifier')); next(); });
  for (const param of ['memberId', 'invitationId']) router.param(param, (_req, _res, next, value) => { if (!z.string().uuid().safeParse(value).success) return next(new ApiError(400, 'INVALID_ID', 'Invalid record identifier')); next(); });
  const paging = (query: unknown) => { const p = pageSchema.safeParse(query); if (!p.success) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid pagination'); return p.data; };
  router.get('/', async (_req, res) => { res.json(await service.list(ctx(res))); });
  router.get('/:businessId', async (req, res) => { res.json(await service.get(ctx(res), String(req.params.businessId))); });
  router.patch('/:businessId', validateBody(businessPatch), async (req, res) => { res.json(await service.update(ctx(res), String(req.params.businessId), req.body)); });
  router.get('/:businessId/roles', async (req, res) => { res.json(await service.roles(ctx(res), String(req.params.businessId))); });
  router.get('/:businessId/members', async (req, res) => { res.json(await service.members(ctx(res), String(req.params.businessId), paging(req.query))); });
  router.patch('/:businessId/members/:memberId', validateBody(memberPatch), async (req, res) => { res.json(await service.updateMember(ctx(res), String(req.params.businessId), String(req.params.memberId), req.body)); });
  router.get('/:businessId/invitations', async (req, res) => { res.json(await service.invitations(ctx(res), String(req.params.businessId), paging(req.query))); });
  router.post('/:businessId/invitations', validateBody(z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), role: z.enum(staffRoles) }).strict()), async (req, res) => {
    await auth.limit('invitations', ctx(res).user.id, 20);
    await invite(auth, ctx(res), { ...req.body, businessId: String(req.params.businessId) }); res.status(202).json({ detail: 'Invitation queued.' });
  });
  router.post('/:businessId/invitations/:invitationId/revoke', validateBody(z.object({}).strict()), async (req, res) => { await service.revokeInvitation(ctx(res), String(req.params.businessId), String(req.params.invitationId)); res.json({ ok: true }); });
  router.get('/:businessId/audit', async (req, res) => { res.json(await service.audit(ctx(res), String(req.params.businessId), paging(req.query))); });
  return router;
}
