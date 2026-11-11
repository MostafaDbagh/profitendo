import { z } from 'zod';
import { digest } from '../../auth/crypto.js';
export type PayPalSettings = { mode: 'sandbox' | 'live'; clientId: string; secret: string; webhookId: string; baseUrl: string; scope: string };
export function readPayPalSettings(env: NodeJS.ProcessEnv): PayPalSettings | null {
  const names = ['B2B_PAYPAL_CLIENT_ID','B2B_PAYPAL_CLIENT_SECRET','B2B_PAYPAL_WEBHOOK_ID'] as const;
  if (!names.some(key => !!env[key])) return null;
  const result = z.object({ B2B_PAYPAL_MODE: z.enum(['sandbox','live']), B2B_PAYPAL_CLIENT_ID: z.string().trim().min(1).max(256), B2B_PAYPAL_CLIENT_SECRET: z.string().min(1).max(512), B2B_PAYPAL_WEBHOOK_ID: z.string().trim().min(1).max(128) }).safeParse(env);
  if (!result.success) throw new Error('Configure B2B_PAYPAL_MODE, B2B_PAYPAL_CLIENT_ID, B2B_PAYPAL_CLIENT_SECRET and B2B_PAYPAL_WEBHOOK_ID together');
  const v = result.data, mode = v.B2B_PAYPAL_MODE;
  return { mode, clientId: v.B2B_PAYPAL_CLIENT_ID, secret: v.B2B_PAYPAL_CLIENT_SECRET, webhookId: v.B2B_PAYPAL_WEBHOOK_ID,
    baseUrl: mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com', scope: digest(`paypal:${mode}:${v.B2B_PAYPAL_CLIENT_ID}`) };
}
