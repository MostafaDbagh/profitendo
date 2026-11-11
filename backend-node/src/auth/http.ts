import type { Request, Response, RequestHandler } from 'express';
import { ApiError } from '../errors.js';
import { csrfFor, equal } from './crypto.js';
import type { AuthService, AuthContext } from './service.js';
export function authHttp(auth: AuthService) {
  const getToken = (req: Request) => {
    const value = (req.headers.cookie ?? '').split(';').map(s => s.trim().split('=')).find(([key]) => key === auth.settings.cookieName)?.[1];
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
  };
  const ctx = (res: Response) => res.locals.auth as AuthContext;
  const attach: RequestHandler = async (req, res, next) => {
    const token = getToken(req);
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in first');
    res.locals.auth = await auth.authenticate(token); next();
  };
  const csrf: RequestHandler = (req, res, next) => {
    if (!equal(req.get('X-CSRF-Token') ?? '', csrfFor(auth.settings.key, ctx(res).token))) {
      throw new ApiError(403, 'CSRF_INVALID', 'Refresh the page and try again');
    }
    next();
  };
  const full: RequestHandler = (_req, res, next) => {
    if (auth.stage(ctx(res)) !== 'authenticated') throw new ApiError(403, 'MFA_REQUIRED', 'Complete MFA first');
    next();
  };
  const origin: RequestHandler = (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('Origin') !== auth.settings.appOrigin) throw new ApiError(403, 'ORIGIN_REQUIRED', 'Request origin is not allowed');
      if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json');
    }
    next();
  };
  return { getToken, ctx, attach, csrf, full, origin };
}
