import { z } from 'zod';
const settingsSchema = z.object({
  AUTH_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  APP_ORIGIN: z.string().url(),
});
export type AuthSettings = { key: Buffer; appOrigin: string; secure: boolean; cookieName: string };
export function readAuthSettings(env: NodeJS.ProcessEnv): AuthSettings {
  const p = settingsSchema.safeParse(env);
  if (!p.success) throw new Error('Configure AUTH_ENCRYPTION_KEY (32 random bytes in hex) and APP_ORIGIN');
  const url = new URL(p.data.APP_ORIGIN);
  const secure = env.NODE_ENV === 'production';
  if (url.origin !== p.data.APP_ORIGIN || !['http:', 'https:'].includes(url.protocol) || (secure && url.protocol !== 'https:')) {
    throw new Error('APP_ORIGIN must be an exact HTTP(S) origin; production requires HTTPS');
  }
  return { key: Buffer.from(p.data.AUTH_ENCRYPTION_KEY, 'hex'), appOrigin: url.origin, secure, cookieName: secure ? '__Host-pl_session' : 'pl_session' };
}
