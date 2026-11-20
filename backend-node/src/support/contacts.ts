import { z } from 'zod';
import type { Tx } from '../auth/service.js';

export const contactSettingsKey = 'support.contacts';
const phone = z.string().trim().max(32)
  .transform(value => value.replace(/[\s()-]/g, ''))
  .pipe(z.union([z.literal(''), z.string().regex(/^\+[1-9]\d{6,14}$/)]));

export const contactSettingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  phone,
  whatsapp: phone,
  email: z.string().trim().toLowerCase().pipe(z.union([z.literal(''), z.email().max(254)])),
}).strict();

export async function readContactSettings(tx: Tx) {
  const row = await tx.systemMetadata.findUnique({where:{key:contactSettingsKey}});
  return row
    ? contactSettingsSchema.parse(JSON.parse(row.value))
    : {revision:0,phone:'',whatsapp:'',email:''};
}
