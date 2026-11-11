import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import * as OTPAuth from 'otpauth';
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const passwordHash = (password: string) => argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const passwordMatches = async (hash: string, password: string) => {
  try { return await argon2.verify(hash, password); } catch { return false; }
};
export function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export const csrfFor = (key: Buffer, token: string) => createHmac('sha256', key).update(`csrf:${token}`).digest('base64url');
export function encrypt(key: Buffer, text: string, context: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(v => v.toString('base64url')).join('.');
}
export function decrypt(key: Buffer, text: string, context: string) {
  const parts = text.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted value');
  const [iv, tag, payload] = parts.map(v => Buffer.from(v, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv!);
  decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(payload!), decipher.final()]).toString('utf8');
}
export const newTotpSecret = () => new OTPAuth.Secret({ size: 20 }).base32;
export const totp = (secret: string, email: string) => new OTPAuth.TOTP({ issuer: 'ProfitLens', label: email, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
export function totpStep(secret: string, email: string, code: string, now = Date.now()) {
  const delta = totp(secret, email).validate({ token: code, window: 1, timestamp: now });
  return delta === null ? null : BigInt(Math.floor(now / 30000) + delta);
}
