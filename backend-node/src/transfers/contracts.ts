import { z } from 'zod';
import { positive } from '../operations/contracts.js';
const lines=z.array(z.object({productId:z.uuid(),quantity:positive}).strict()).min(1).max(100)
 .refine(rows=>new Set(rows.map(r=>r.productId)).size===rows.length);
export const transferSchema=z.object({
 clientKey:z.uuid(),sourceId:z.uuid(),destinationId:z.uuid(),notes:z.string().trim().max(2000).default(''),lines,
}).strict().refine(v=>v.sourceId!==v.destinationId);
export const transferPatch=z.object({revision:z.number().int().nonnegative(),notes:z.string().trim().max(2000).default(''),lines}).strict();
export const transferAction=z.object({revision:z.number().int().nonnegative(),action:z.enum(['dispatch','cancel']),confirm:z.literal(true)}).strict();
export const transferEvent=z.object({
 clientKey:z.uuid(),revision:z.number().int().nonnegative(),kind:z.enum(['RECEIVE','RETURN','LOSS']),
 reason:z.string().trim().max(2000).default(''),confirm:z.literal(true),
 lines:z.array(z.object({lineId:z.uuid(),quantity:positive}).strict()).min(1).max(100)
 .refine(rows=>new Set(rows.map(r=>r.lineId)).size===rows.length),
}).strict().refine(v=>v.kind==='RECEIVE'||v.reason.length>=5);
export type TransferInput=z.infer<typeof transferSchema>;
export type TransferPatch=z.infer<typeof transferPatch>;
export type TransferEventInput=z.infer<typeof transferEvent>;
