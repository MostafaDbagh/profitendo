import {z} from 'zod';
import type {Tx} from '../auth/service.js';
import {ApiError} from '../errors.js';
import {businessDay} from '../finance/cash.js';
import {isSupportedCountry,parsePhoneNumberFromString} from 'libphonenumber-js';

export function customerPhone(raw:string,country:string|null){
 const value=raw.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[\s()-]/g,'').replace(/^00/,'+');
 if(!/^\+?\d+$/.test(value))return null;
 const region=country&&isSupportedCountry(country)?country:undefined;
 const parsed=parsePhoneNumberFromString(value,{defaultCountry:region,extract:false});
 return parsed?.isPossible()?parsed.number:null;
}
const stage=z.object({step:z.number().int().positive(),name:z.string().trim().min(1).max(120),productId:z.uuid().nullable()}).strict();
export const programSchema=z.object({enabled:z.boolean(),length:z.number().int().min(1).max(365),repeat:z.boolean(),stages:z.array(stage).max(365)}).strict().refine(p=>(!p.enabled||p.stages.length>0)&&p.stages.every(s=>s.step<=p.length)&&new Set(p.stages.map(s=>s.step)).size===p.stages.length);
export type Program=z.infer<typeof programSchema>;
export const programOf=(value:unknown):Program=>programSchema.safeParse(value).data??{enabled:false,length:10,repeat:true,stages:[]};
export async function profile(tx:Tx,businessId:string,id:string,timezone:string,program:Program,page=1){
 const customer=await tx.customer.findFirst({where:{businessId,id}});
 if(!customer)throw new ApiError(404,'NOT_FOUND','Customer not found');
 const where={businessId,customerId:id};
 const [visits,rewards,count,today]=await Promise.all([
  tx.loyaltyVisit.findMany({where,orderBy:{day:'desc'},skip:(page-1)*50,take:51}),
  tx.loyaltyReward.findMany({where,orderBy:{id:'asc'}}),
  tx.loyaltyVisit.count({where:{...where,reversed:false}}),
  tx.loyaltyVisit.findFirst({where:{...where,day:businessDay(new Date(),timezone),reversed:false}})
 ]);
 const staffIds=[...new Set(rewards.flatMap(r=>r.redeemedBy?[r.redeemedBy]:[]))];
 const staff=staffIds.length?await tx.authUser.findMany({where:{id:{in:staffIds}},select:{id:true,name:true}}):[];
 const names=new Map(staff.map(user=>[user.id,user.name]));
 return {...customer,timezone,visits:visits.slice(0,50),hasMore:visits.length>50,
  rewards:rewards.map(r=>({...r,redeemedName:r.redeemedBy?names.get(r.redeemedBy):null})),count,today:!!today,program};
}
export async function recordVisit(tx:Tx,businessId:string,customerId:string,saleId:string,day:string,program:Program){
 if(!program.enabled)return;
 const where={businessId,customerId};
 // Updating the customer's row serializes simultaneous checkouts, including at cycle rollover.
 const customer=await tx.customer.update({where:{businessId_id:{businessId,id:customerId}},data:{progress:{increment:0}}});
 if(await tx.loyaltyVisit.findFirst({where:{...where,day,reversed:false}}))return;
 if(!program.repeat&&customer.progress>=program.length)return;
 const step=Math.min(customer.progress+1,program.length);
 const visit=await tx.loyaltyVisit.create({data:{...where,day,saleId,step,cycle:customer.cycle}});
 const gift=program.stages.find(s=>s.step===step);
 if(gift){
  const earlier=await tx.loyaltyVisit.findMany({where:{...where,cycle:customer.cycle,step,id:{not:visit.id}},select:{id:true}});
  const existing=await tx.loyaltyReward.findFirst({where:{...where,visitId:{in:earlier.map(v=>v.id)},OR:[{voided:false},{redeemedAt:{not:null}}]}});
  if(!existing)await tx.loyaltyReward.create({data:{...where,visitId:visit.id,name:gift.name,productId:gift.productId}});
 }
 const renew=program.repeat&&step===program.length;
 await tx.customer.update({where:{id:customerId},data:{progress:renew?0:step,cycle:customer.cycle+(renew?1:0)}});
}
export async function fullyReturned(tx:Tx,businessId:string,saleId:string){
 const lines=await tx.saleLine.findMany({where:{businessId,saleId},select:{id:true,baseQuantity:true}});
 const returned=await tx.adjustmentLine.groupBy({by:['sourceLineId'],where:{businessId,document:{sourceId:saleId,kind:'CUSTOMER_RETURN',status:'COMPLETED'}},_sum:{quantity:true}});
 return lines.length>0&&lines.every(l=>returned.some(r=>r.sourceLineId===l.id&&r._sum.quantity?.gte(l.baseQuantity)));
}
export async function reverseReturnedVisit(tx:Tx,businessId:string,saleId:string){
 const visit=await tx.loyaltyVisit.findFirst({where:{businessId,saleId,reversed:false}});
 if(!visit||!await fullyReturned(tx,businessId,saleId))return;
 const customer=await tx.customer.update({where:{id:visit.customerId},data:{progress:{increment:0}}});
 const replacements=await tx.sale.findMany({where:{businessId,customerId:visit.customerId,loyaltyDay:visit.day,status:'COMPLETED',id:{not:saleId}},orderBy:{completedAt:'asc'},select:{id:true}});
 for(const candidate of replacements)if(!await fullyReturned(tx,businessId,candidate.id)){
  await tx.loyaltyVisit.update({where:{id:visit.id},data:{saleId:candidate.id}});return;
 }
 await tx.loyaltyVisit.update({where:{id:visit.id},data:{reversed:true}});
 await tx.loyaltyReward.updateMany({where:{businessId,visitId:visit.id},data:{voided:true}});
 if(customer.cycle===visit.cycle&&customer.progress>0)await tx.customer.update({where:{id:customer.id},data:{progress:{decrement:1}}});
 else if(customer.cycle===visit.cycle+1&&customer.progress===0){
  const progress=await tx.loyaltyVisit.count({where:{businessId,customerId:customer.id,cycle:visit.cycle,reversed:false}});
  await tx.customer.update({where:{id:customer.id},data:{cycle:visit.cycle,progress}});
 }
}
