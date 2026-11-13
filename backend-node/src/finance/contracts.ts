import {z} from 'zod';
import {positive} from '../operations/contracts.js';
import {decimal} from '../catalogue/contracts.js';
export const paymentSchema=z.object({clientKey:z.uuid(),locationId:z.uuid(),kind:z.enum(['SUPPLIER_PAYMENT','SUPPLIER_REFUND','CUSTOMER_REFUND','EXPENSE','CASH_IN','CASH_OUT']),sourceId:z.uuid().optional(),method:z.enum(['CASH','CARD','TRANSFER']),amount:positive,reference:z.string().trim().max(150).default(''),reason:z.string().trim().min(5).max(2000),confirm:z.literal(true)}).strict().refine(v=>['SUPPLIER_PAYMENT','SUPPLIER_REFUND','CUSTOMER_REFUND'].includes(v.kind)===!!v.sourceId).refine(v=>v.method==='CASH'||v.reference.length>0).refine(v=>!['CASH_IN','CASH_OUT'].includes(v.kind)||v.method==='CASH');
export const closeSchema=z.object({locationId:z.uuid(),day:z.iso.date(),opening:decimal,counted:decimal,expected:decimal.or(z.string().regex(/^-(0|[1-9]\d{0,13})(\.\d{1,4})?$/)),reason:z.string().trim().max(2000).default(''),confirm:z.literal(true)}).strict();
export type PaymentInput=z.infer<typeof paymentSchema>;
export type CloseInput=z.infer<typeof closeSchema>;

export const reversalSchema=z.object({clientKey:z.uuid(),reason:z.string().trim().min(5).max(2000),confirm:z.literal(true)}).strict();
export type ReversalInput=z.infer<typeof reversalSchema>;
