import { configureOwnerPin, ownerPinDeviceCookie, rememberOwnerPinDevice, unlockOwnerPin } from './owner-pin.js';
import { chartAccountsRouter } from './chart-accounts.js';
import { partnerRouter } from './partners.js';
import { exportBusinessBackup } from './backup.js';
import { resetOperationalData } from './reset.js';
import {createMember} from './create-member.js';
import { countryCurrencies } from './countries.js';
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
  countryCode: z.string().refine(v => v in countryCurrencies).nullable().optional(),
  salesTaxRate: z.string().regex(/^(0|[1-9]\d?)(\.\d{1,4})?$|^100(?:\.0{1,4})?$/).optional(),
  revision: z.number().int().nonnegative(), name: z.string().trim().min(2).max(120).optional(), baseCurrency: currency.optional(),
  timezone: z.string().max(80).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }).optional(),
  dateFormat: z.enum(['dmy','mdy','ymd']).optional(), numberFormat: z.enum(['western','european','arabic']).optional(),
}).strict().refine(v => Object.keys(v).length > 1);
const overrides = z.record(z.string(), z.boolean()).refine(values => Object.keys(values).every(k => permissionKeys.includes(k as typeof permissionKeys[number]) && !PERMISSIONS[k as typeof permissionKeys[number]].ownerOnly));
const memberPatch = z.object({ revision: z.number().int().nonnegative(), role: z.enum(staffRoles).optional(), customRoleId: z.string().uuid().nullable().optional(), permissionOverrides: overrides.optional(), active: z.boolean().optional() }).strict().refine(v => Object.keys(v).length > 1);
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
  router.patch('/:businessId/preferences', validateBody(z.object({ ownerAsCashier: z.boolean().optional(), hiddenTabs: z.array(z.enum(['expenses','reports','returns','counts','damage','payments','migration','sales','transfers','inventory','suppliers','purchases','catalogue','locations','billing','team','roles','invitations','audit','partners','accounts'])).max(21), tabOrder: z.array(z.enum(['dashboard','security','settings','expenses','reports','returns','counts','damage','payments','migration','sales','transfers','inventory','suppliers','purchases','catalogue','locations','billing','team','roles','invitations','audit','partners','accounts'])).max(24).refine(v => new Set(v).size === v.length).optional() }).strict()), async (req, res) => { res.json(await service.preferences(ctx(res), String(req.params.businessId), req.body.hiddenTabs, req.body.tabOrder, req.body.ownerAsCashier)); });
  router.patch('/:businessId', validateBody(businessPatch), async (req, res) => { res.json(await service.update(ctx(res), String(req.params.businessId), req.body)); });
  const pin = z.string().regex(/^[0-9]{4,8}$/);
  router.put('/:businessId/owner-pin', validateBody(z.object({pin: pin.nullable(), password: z.string().min(1).max(128)}).strict()), async (req,res) => {
    res.json(await configureOwnerPin(auth, ctx(res), String(req.params.businessId), req.body.password, req.body.pin));
  });
  router.post('/:businessId/owner-pin/device', validateBody(z.object({password:z.string().min(1).max(128)}).strict()), async (req,res) => {
    const token = await rememberOwnerPinDevice(auth, ctx(res), String(req.params.businessId), req.body.password);
    const cookie = ownerPinDeviceCookie(auth);
    res.cookie(cookie.name, token, cookie.options).json({ok:true});
  });
  router.post('/:businessId/owner-pin/unlock', validateBody(z.object({pin}).strict()), async (req,res) => {
    res.json(await unlockOwnerPin(auth, ctx(res), String(req.params.businessId), req.body.pin));
  });
  router.get('/:businessId/backup', async (req, res) => {
    const query = z.object({ format: z.enum(['json', 'xlsx']) }).strict().safeParse(req.query);
    if (!query.success) throw new ApiError(422, 'VALIDATION_ERROR', 'Choose JSON or Excel');
    await auth.limit('business-backup', ctx(res).user.id, 10, 900);
    const { format } = query.data;
    const file = await exportBusinessBackup(auth, ctx(res), String(req.params.businessId), format);
    const day = new Date().toISOString().slice(0, 10);
    res.attachment(`profitlens-backup-${day}.${format}`).send(file);
  });
  router.delete('/:businessId/operational-data', validateBody(z.object({
    confirmation: z.literal('DELETE ALL DATA'), password: z.string().min(1).max(128),
  }).strict()), async (req, res) => {
    await auth.limit('business-data-reset', ctx(res).user.id, 5, 900);
    await resetOperationalData(auth, ctx(res), String(req.params.businessId), req.body.password);
    res.status(200).json({ ok: true });
  });
  router.use('/:businessId/accounts', chartAccountsRouter(auth));
  router.use('/:businessId/partners', partnerRouter(auth));
  router.get('/:businessId/roles', async (req, res) => { res.json(await service.roles(ctx(res), String(req.params.businessId))); });
  router.post('/:businessId/roles', validateBody(z.object({ name: z.string().trim().min(2).max(80), permissions: overrides }).strict()), async (req, res) => { res.status(201).json(await service.createRole(ctx(res), String(req.params.businessId), req.body)); });
  router.post('/:businessId/members', validateBody(z.object({name:z.string().trim().min(2).max(100),email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(8).max(128),role:z.enum(staffRoles).optional(),customRoleId:z.string().uuid().optional(),locationIds:z.array(z.string().uuid()).max(100)}).strict().refine(v=>Boolean(v.role)!==Boolean(v.customRoleId))),async(req,res)=>{await auth.limit('create-member',ctx(res).user.id,20);res.status(201).json(await createMember(auth,ctx(res),{...req.body,businessId:String(req.params.businessId)}));});
  router.get('/:businessId/members', async (req, res) => { res.json(await service.members(ctx(res), String(req.params.businessId), paging(req.query))); });
  router.patch('/:businessId/members/:memberId', validateBody(memberPatch), async (req, res) => { res.json(await service.updateMember(ctx(res), String(req.params.businessId), String(req.params.memberId), req.body)); });
  router.get('/:businessId/invitations', async (req, res) => { res.json(await service.invitations(ctx(res), String(req.params.businessId), paging(req.query))); });
  router.post('/:businessId/invitations', validateBody(z.object({ password: z.string().min(8).max(128).optional(), locationIds: z.array(z.string().uuid()).max(100).optional(), name: z.string().trim().min(2).max(100).optional(), email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), role: z.enum(staffRoles).optional(), customRoleId: z.string().uuid().optional() }).strict().refine(v => Boolean(v.role) !== Boolean(v.customRoleId))), async (req, res) => {
    await auth.limit('invitations', ctx(res).user.id, 20);
    await invite(auth, ctx(res), { ...req.body, businessId: String(req.params.businessId) }); res.status(202).json({ detail: 'Invitation queued.' });
  });
  router.post('/:businessId/invitations/:invitationId/revoke', validateBody(z.object({}).strict()), async (req, res) => { await service.revokeInvitation(ctx(res), String(req.params.businessId), String(req.params.invitationId)); res.json({ ok: true }); });
  router.get('/:businessId/audit', async (req, res) => { res.json(await service.audit(ctx(res), String(req.params.businessId), paging(req.query))); });
  return router;
}
