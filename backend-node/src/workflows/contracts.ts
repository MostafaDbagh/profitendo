import {z} from 'zod';
import {decimal} from '../catalogue/contracts.js';
export const kinds=z.enum(['CUSTOMER_RETURN','SUPPLIER_RETURN','COUNT','DAMAGE','OPENING']);
export const adjustmentSchema=z.object({clientKey:z.uuid(),kind:kinds,locationId:z.uuid(),sourceId:z.uuid().optional(),reason:z.string().trim().min(5).max(2000),lines:z.array(z.object({productId:z.uuid(),sourceLineId:z.uuid().optional(),snapshotToken:z.uuid().nullable().optional(),expected:decimal.optional(),quantity:decimal,condition:z.enum(['RESTOCK','DAMAGED']).default('RESTOCK')}).strict()).min(1).max(100)}).strict().superRefine((v,ctx)=>{
 if(v.kind==='COUNT'&&v.lines.some(l=>l.snapshotToken===undefined||l.expected===undefined))ctx.addIssue({code:'custom',message:'Count snapshot required'});
 const returns=['CUSTOMER_RETURN','SUPPLIER_RETURN'].includes(v.kind);if(returns!==!!v.sourceId)ctx.addIssue({code:'custom',message:'Source required for returns'});
 if(!returns&&v.lines.some(l=>l.sourceLineId))ctx.addIssue({code:'custom',message:'Source lines only belong to returns'});
 const keys=v.lines.map(l=>returns?l.sourceLineId:l.productId);if(new Set(keys).size!==keys.length||returns&&keys.some(k=>!k))ctx.addIssue({code:'custom',message:'Unique source lines or products required'});
 if(v.kind!=='COUNT'&&v.lines.some(l=>!/[1-9]/.test(l.quantity)))ctx.addIssue({code:'custom',message:'Positive quantity required'});
 if(v.kind!=='CUSTOMER_RETURN'&&v.lines.some(l=>l.condition!=='RESTOCK'))ctx.addIssue({code:'custom',message:'Condition is only used on customer returns'});
});
export const adjustmentAction=z.object({revision:z.number().int().nonnegative(),action:z.enum(['confirm','cancel']),confirm:z.literal(true)}).strict();
export type AdjustmentInput=z.infer<typeof adjustmentSchema>;
