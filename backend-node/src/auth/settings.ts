import { z } from 'zod';
const settingsSchema = z.object({
  AUTH_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  APP_ORIGIN: z.string().url(),
});
export type AuthSettings = { key: Buffer; appOrigin: string; secure: boolean; cookieName: string; mockOtp: boolean; ownerPhoneRequired:boolean; emailOtp:boolean };
export function readAuthSettings(env: NodeJS.ProcessEnv): AuthSettings {
  const p = settingsSchema.safeParse(env);
  if (!p.success) throw new Error('Configure AUTH_ENCRYPTION_KEY (32 random bytes in hex) and APP_ORIGIN');
  const url = new URL(p.data.APP_ORIGIN);
  const secure = env.NODE_ENV === 'production';
  if (url.origin !== p.data.APP_ORIGIN || !['http:', 'https:'].includes(url.protocol) || (secure && url.protocol !== 'https:')) {
    throw new Error('APP_ORIGIN must be an exact HTTP(S) origin; production requires HTTPS');
  }
  if(env.AUTH_MOCK_OTP!==undefined&&!['true','false'].includes(env.AUTH_MOCK_OTP))throw new Error('AUTH_MOCK_OTP must be true or false');
  if(env.AUTH_OTP_PROVIDER!==undefined&&env.AUTH_OTP_PROVIDER!=='authenticator')throw new Error('AUTH_OTP_PROVIDER must be authenticator; SMS/email OTP is not configured');
  if(env.AUTH_OWNER_PHONE_REQUIRED!==undefined&&!['true','false'].includes(env.AUTH_OWNER_PHONE_REQUIRED))throw new Error('AUTH_OWNER_PHONE_REQUIRED must be true or false');
  if(env.AUTH_EMAIL_VERIFICATION!==undefined&&!['otp','link'].includes(env.AUTH_EMAIL_VERIFICATION))throw new Error('AUTH_EMAIL_VERIFICATION must be otp or link');
  if(secure&&(env.AUTH_OWNER_PHONE_REQUIRED==='false'||env.AUTH_EMAIL_VERIFICATION==='link'))throw new Error('Production requires owner phone and email OTP verification');
  const ownerPhoneRequired=secure||env.AUTH_OWNER_PHONE_REQUIRED==='true',emailOtp=secure||env.AUTH_EMAIL_VERIFICATION==='otp';
  const mockOtp=env.AUTH_MOCK_OTP==='true';
  const loopback=new Set(['localhost','127.0.0.1','[::1]','::1']);
  if(mockOtp&&(!['development','test'].includes(env.NODE_ENV??'')||!loopback.has(url.hostname)||!loopback.has(env.HOST??'127.0.0.1')||(env.DATABASE_URL&&!loopback.has(new URL(env.DATABASE_URL).hostname)))){
    throw new Error('AUTH_MOCK_OTP is restricted to explicit development/test mode with loopback app, API and database hosts');
  }
  return { ownerPhoneRequired,emailOtp,mockOtp, key: Buffer.from(p.data.AUTH_ENCRYPTION_KEY, 'hex'), appOrigin: url.origin, secure, cookieName: secure ? '__Host-pl_session' : 'pl_session' };
}
