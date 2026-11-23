import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { decimal } from '../catalogue/contracts.js';
export const positive=decimal.refine(value=>decimal.safeParse(value).success && /[1-9]/.test(value));
export const supplierSchema=z.object({
 code:z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/).default(()=>'SUP-'+randomBytes(10).toString('hex').toUpperCase()),
 name:z.string().trim().min(2).max(160),contact:z.string().trim().max(160).default(''),
 phone:z.string().trim().max(40).default(''),email:z.union([z.email().max(254),z.literal('')]).default(''),
 address:z.string().trim().max(500).default(''),notes:z.string().trim().max(2000).default(''),
}).strict();
export const supplierPatch=supplierSchema.omit({code:true}).partial().extend({active:z.boolean().optional(),revision:z.number().int().nonnegative()}).strict();
const line=z.object({productId:z.uuid(),quantity:positive,packId:z.uuid().optional(),plannedItemId:z.uuid().optional(),unitCost:decimal.optional()}).strict();
const inventoryDocument=z.object({
 clientKey:z.uuid(),kind:z.enum(['ORDER','RECEIPT']),locationId:z.uuid(),supplierId:z.uuid().nullable().optional(),
 orderId:z.uuid().optional(),documentDate:z.iso.date(),supplierReference:z.string().trim().max(120).default(''),
 notes:z.string().trim().max(2000).default(''),lines:z.array(line).min(1).max(100)
 .refine(lines=>new Set(lines.map(l=>l.productId)).size===lines.length),
}).strict().refine(v=>v.kind!=='ORDER'||(!v.orderId&&Boolean(v.supplierId)));
const inventoryPatch=z.object({
 revision:z.number().int().nonnegative(),documentDate:z.iso.date(),supplierReference:z.string().trim().max(120).default(''),
 notes:z.string().trim().max(2000).default(''),lines:z.array(line).min(1).max(100)
 .refine(lines=>new Set(lines.map(l=>l.productId)).size===lines.length),
}).strict();
const planningFields=z.object({
 documentDate:z.iso.date(),supplierId:z.uuid().nullable().optional(),notes:z.string().trim().max(2000).default(''),
 plannedItems:z.array(z.object({name:z.string().trim().min(1).max(160),quantity:positive}).strict()).min(1).max(100),
}).strict();
export const documentSchema=z.union([planningFields.extend({clientKey:z.uuid(),kind:z.literal('ORDER')}),inventoryDocument]);
export const documentPatch=z.union([planningFields.extend({revision:z.number().int().nonnegative()}),inventoryPatch]);
export type InventoryDocumentInput=z.infer<typeof inventoryDocument>;
export const transitionSchema=z.object({revision:z.number().int().nonnegative(),action:z.enum(['submit','reopen','confirm','receive','cancel']),confirm:z.literal(true)}).strict();
export type DocumentInput=z.infer<typeof documentSchema>;
export type DocumentPatch=z.infer<typeof documentPatch>;
