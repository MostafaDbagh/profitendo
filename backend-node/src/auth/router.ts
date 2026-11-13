import {ContactVerification} from './verification.js';
import QRCode from 'qrcode';
import { MockEmailOtp, otpCode, otpPurpose } from './mock-otp.js';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { ApiError, validateBody } from '../errors.js';
import { csrfFor, equal } from './crypto.js';
import { authHttp } from './http.js';
import { AuthService, type AuthContext } from './service.js';
import { invite, acceptInvitation, revokeInvitation, disableMember } from './invitations.js';
const email = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const password = z.string().min(12).max(128);
const token = z.string().length(43).regex(/^[A-Za-z0-9_-]{43}$/);
const code = z.union([otpCode,z.string().length(24).regex(/^[a-f0-9]{24}$/)]);
const genericMessage = { detail: 'If eligible, an email will be sent with the next steps.' };
export function authRouter(auth: AuthService) {
  const router = Router();
  const cookieOptions = { httpOnly: true, secure: auth.settings.secure, sameSite: 'lax' as const, path: '/' };
  const { getToken, ctx, attach, csrf, full, origin } = authHttp(auth);
  const signedWrite = [attach, csrf, full];
  const sendSession = async (res: Response, context: AuthContext, extras = {}) => {
    res.cookie(auth.settings.cookieName, context.token, { ...cookieOptions, maxAge: context.session.expiresAt.getTime() - Date.now() });
    res.json({ ...await auth.sessionResult(context), ...extras });
  };
  router.use(origin);
  router.use(async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    await auth.limit('http', req.ip ?? 'unknown', 120, 60);
    next();
  });
  router.get('/config',(_req,res)=>res.json({mockOtp:auth.settings.mockOtp,emailOtp:auth.settings.emailOtp,ownerPhoneRequired:auth.settings.ownerPhoneRequired}));
  const verification=new ContactVerification(auth);
  router.post('/email-code/request',validateBody(z.object({email}).strict()),async(req,res)=>{
    await auth.limit('email-code-ip',req.ip??'',10,900);await auth.limit('email-code-account',req.body.email,3,900);
    res.status(202).json(await verification.requestEmail(req.body.email));
  });
  router.post('/email-code/confirm',validateBody(z.object({challenge:token,code:otpCode}).strict()),async(req,res)=>{
    await auth.limit('email-code-confirm',req.ip??'',30,900);res.json(await verification.confirm(req.body.challenge,req.body.code,'EMAIL'));
  });
  router.post('/phone-code/request',attach,csrf,validateBody(z.object({phone:z.string().min(9).max(40)}).strict()),async(req,res)=>{
    await auth.limit('phone-code-ip',req.ip??'',10,3600);res.status(202).json(await verification.requestPhone(ctx(res),req.body.phone));
  });
  router.post('/phone-code/confirm',attach,csrf,validateBody(z.object({challenge:token,code:otpCode}).strict()),async(req,res)=>{
    await auth.limit('phone-code-confirm',ctx(res).user.id,20,900);await verification.confirm(req.body.challenge,req.body.code,'PHONE',ctx(res));await sendSession(res,await auth.authenticate(ctx(res).token));
  });
  const mock=new MockEmailOtp(auth);
  router.post('/mock-code/request',(_req,_res,next)=>{mock.enabled();next();},validateBody(z.object({email,purpose:otpPurpose}).strict()),async(req,res)=>{
    await auth.limit('mock-email-ip',req.ip??'',10);await auth.limit('mock-email',req.body.email,3);
    res.status(202).json(await mock.request(req.body.email,req.body.purpose));
  });
  router.post('/mock-code/confirm',(_req,_res,next)=>{mock.enabled();next();},validateBody(z.object({challenge:token,purpose:otpPurpose,code:otpCode}).strict()),async(req,res)=>{
    await auth.limit('mock-confirm-ip',req.ip??'',30);await auth.limit('mock-confirm',req.body.challenge,5);
    res.json(await mock.confirm(req.body.challenge,req.body.purpose,req.body.code));
  });
  router.post('/register' , validateBody(z.object({ email, password, name: z.string().trim().min(2).max(100), businessName: z.string().trim().min(2).max(120),language:z.enum(['en','ar']).optional() }).strict()), async (req, res) => {
    await auth.limit('register-ip', req.ip ?? '', 5);
    await auth.limit('register-email', req.body.email, 3);
    await auth.register(req.body); res.status(202).json(genericMessage);
  });
  router.post('/login', validateBody(z.object({ email, password: z.string().min(1).max(128) }).strict()), async (req, res) => {
    await auth.limit('login-ip', req.ip ?? '', 30);
    await auth.limit('login-email', req.body.email, 10);
    await sendSession(res, await auth.login(req.body.email, req.body.password));
  });
  for (const [path, kind] of [['/forgot-password', 'PASSWORD_RESET'], ['/verification/request', 'VERIFY_EMAIL']] as const) {
    router.post(path, validateBody(z.object({ email }).strict()), async (req, res) => {
      await auth.limit('email-ip', req.ip ?? '', 10);
      await auth.limit('email-account', req.body.email, 3);
      if(kind==='VERIFY_EMAIL'&&auth.settings.emailOtp){res.status(202).json(await verification.requestEmail(req.body.email));return;}
      await auth.requestToken(req.body.email, kind); res.status(202).json(genericMessage);
    });
  }
  router.post('/verification/confirm', validateBody(z.object({ token }).strict()), async (req, res) => {
    await auth.consumeToken(req.body.token, 'VERIFY_EMAIL'); res.json({ detail: 'Email verified. Sign in to continue.' });
  });
  router.post('/reset-password', validateBody(z.object({ token, password }).strict()), async (req, res) => {
    await auth.limit('reset-ip', req.ip ?? '', 10);
    await auth.consumeToken(req.body.token, 'PASSWORD_RESET', req.body.password);
    res.clearCookie(auth.settings.cookieName, cookieOptions).json({ detail: 'Password reset. Sign in again.' });
  });
  router.get('/me', attach, async (_req, res) => { res.json(await auth.sessionResult(ctx(res))); });
  router.post('/logout', attach, csrf, async (_req, res) => {
    await auth.revoke(ctx(res), ctx(res).session.id);
    res.clearCookie(auth.settings.cookieName, cookieOptions).json({ ok: true });
  });
  router.post('/lock', attach, csrf, async (_req, res) => {
    await auth.revoke(ctx(res), ctx(res).session.id);
    res.clearCookie(auth.settings.cookieName, cookieOptions).json({ ok: true });
  });
  router.get('/sessions', attach, full, async (_req, res) => {
    const rows = await auth.db.authSession.findMany({ where: { userId: ctx(res).user.id, expiresAt: { gt: new Date() }, securityVersion: ctx(res).user.securityVersion, lastSeenAt: { gt: new Date(Date.now() - 30 * 60000) } }, select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true } });
    res.json(rows.map(row => ({ ...row, current: row.id === ctx(res).session.id })));
  });
  router.post('/sessions/revoke', ...signedWrite, validateBody(z.object({ sessionId: z.string().uuid().optional() }).strict()), async (req, res) => {
    await auth.revoke(ctx(res), req.body.sessionId);
    if (!req.body.sessionId || req.body.sessionId === ctx(res).session.id) res.clearCookie(auth.settings.cookieName, cookieOptions);
    res.json({ ok: true });
  });
  router.post('/password', ...signedWrite, validateBody(z.object({ currentPassword: z.string().max(128), password }).strict()), async (req, res) => {
    await auth.limit('password', ctx(res).user.id, 5);
    await auth.changePassword(ctx(res), req.body.currentPassword, req.body.password);
    res.clearCookie(auth.settings.cookieName, cookieOptions).json({ ok: true });
  });
  router.post('/mfa/disable', ...signedWrite, validateBody(z.object({ password: z.string().min(1).max(128), code: otpCode }).strict()), async (req,res) => {
    await auth.limit('mfa', ctx(res).user.id, 10);
    await sendSession(res, await auth.disableMfa(ctx(res), req.body.password, req.body.code));
  });
  router.post('/mfa/setup', attach, csrf, validateBody(z.object({ password: z.string().max(128) }).strict()), async (req, res) => {
    await auth.limit('mfa', ctx(res).user.id, 10);
    const setup = await auth.beginMfa(ctx(res), req.body.password);
    const qrCode = await QRCode.toDataURL(setup.uri, { errorCorrectionLevel: 'M', margin: 4, width: 256 });
    res.json({ ...setup, qrCode });
  });
  router.post('/mfa/confirm', attach, csrf, validateBody(z.object({ code:otpCode }).strict()), async (req, res) => {
    await auth.limit('mfa', ctx(res).user.id, 10);
    const result = await auth.confirmMfa(ctx(res), req.body.code);
    await sendSession(res, result, { recoveryCodes: result.recoveryCodes });
  });
  router.post('/mfa/verify', attach, csrf, validateBody(z.object({ code }).strict()), async (req, res) => {
    await auth.limit('mfa', ctx(res).user.id, 10);
    await sendSession(res, await auth.verifyMfa(ctx(res), req.body.code));
  });
  router.post('/invitations', ...signedWrite, validateBody(z.object({ businessId: z.string().uuid(), email, role: z.enum(['OPERATIONS_MANAGER','WAREHOUSE_STAFF','SHOP_MANAGER','CASHIER','VIEWER']) }).strict()), async (req, res) => {
    await auth.limit('invitations', ctx(res).user.id, 20);
    await invite(auth, ctx(res), req.body); res.status(202).json({ detail: 'Invitation queued.' });
  });
  router.post('/invitations/revoke', ...signedWrite, validateBody(z.object({ invitationId: z.string().uuid() }).strict()), async (req, res) => {
    await revokeInvitation(auth, ctx(res), req.body.invitationId); res.json({ ok: true });
  });
  router.post('/invitations/accept', validateBody(z.object({ token, name: z.string().trim().min(2).max(100).optional(), password: password.optional() }).strict()), async (req, res) => {
    await auth.limit('invite-accept', req.ip ?? '', 10);
    const raw = getToken(req);
    let context: AuthContext | undefined;
    if (raw) {
      context = await auth.authenticate(raw);
      if (!equal(req.get('X-CSRF-Token') ?? '', csrfFor(auth.settings.key, raw))) throw new ApiError(403, 'CSRF_INVALID', 'Refresh and try again');
    }
    await acceptInvitation(auth, req.body, context); res.json({ detail: 'Invitation accepted. Sign in to continue.' });
  });
  router.post('/members/disable', ...signedWrite, validateBody(z.object({ membershipId: z.string().uuid() }).strict()), async (req, res) => {
    await disableMember(auth, ctx(res), req.body.membershipId); res.json({ ok: true });
  });
  return router;
}
