import { z } from 'zod';
import { decimal } from '../catalogue/contracts.js';
export const positive=decimal.refine(value=>decimal.safeParse(value).success && /[1-9]/.test(value));
export const supplierSchema=z.object({
 code:z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/),
 name:z.string().trim().min(2).max(160),contact:z.string().trim().max(160).default(''),
 phone:z.string().trim().max(40).default(''),email:z.union([z.email().max(254),z.literal('')]).default(''),
 address:z.string().trim().max(500).default(''),notes:z.string().trim().max(2000).default(''),
}).strict();
export const supplierPatch=supplierSchema.omit({code:true}).partial().extend({active:z.boolean().optional(),revision:z.number().int().nonnegative()}).strict();
const line=z.object({productId:z.uuid(),quantity:positive,packId:z.uuid().optional(),unitCost:decimal.optional()}).strict();
export const documentSchema=z.object({
 clientKey:z.uuid(),kind:z.enum(['ORDER','RECEIPT']),locationId:z.uuid(),supplierId:z.uuid(),
 orderId:z.uuid().optional(),documentDate:z.iso.date(),supplierReference:z.string().trim().max(120).default(''),
 notes:z.string().trim().max(2000).default(''),lines:z.array(line).min(1).max(100)
 .refine(lines=>new Set(lines.map(l=>l.productId)).size===lines.length),
}).strict().refine(v=>v.kind!=='ORDER'||!v.orderId);
export const documentPatch=z.object({
 revision:z.number().int().nonnegative(),documentDate:z.iso.date(),supplierReference:z.string().trim().max(120).default(''),
 notes:z.string().trim().max(2000).default(''),lines:z.array(line).min(1).max(100)
 .refine(lines=>new Set(lines.map(l=>l.productId)).size===lines.length),
}).strict();
export const transitionSchema=z.object({revision:z.number().int().nonnegative(),action:z.enum(['submit','reopen','confirm','cancel']),confirm:z.literal(true)}).strict();
export type DocumentInput=z.infer<typeof documentSchema>;
export type DocumentPatch=z.infer<typeof documentPatch>;
