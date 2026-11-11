import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url().refine(v => {
    try { return ['postgres:', 'postgresql:'].includes(new URL(v).protocol); }
    catch { return false; }
  }),
  CORS_ORIGINS: z.string().min(1).transform(v => v.split(',').map(s => s.trim())).pipe(
    z.array(z.string().url().refine(v => {
      try {
        const u = new URL(v);
        return ['http:', 'https:'].includes(u.protocol) && u.origin === v;
      } catch { return false; }
    })).min(1)),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info'),
});
export function readConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env);
  // Never interpolate input values: URLs can contain credentials.
  if (!result.success) throw new Error(`Invalid configuration: ${[...new Set(result.error.issues.map(i => i.path.join('.')))].join(', ')}`);
  if (result.data.NODE_ENV === 'production' && result.data.CORS_ORIGINS.some(v => !v.startsWith('https://'))) {
    throw new Error('Production CORS_ORIGINS must use HTTPS');
  }
  return result.data;
}
export type Config = ReturnType<typeof readConfig>;
