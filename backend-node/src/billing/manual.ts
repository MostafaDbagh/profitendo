import {z} from 'zod';
import type {AuthContext,AuthService} from '../auth/service.js';
import {requirePlatform} from '../platform/service.js';
import {ApiError} from '../errors.js';
import {lockCapacity,memberUsage} from './entitlements.js';
export const manualPaymentSchema=z.object({requestKey:z.uuid(),planId:z.uuid(),method:z.enum(['SHAM_CASH','PAYPAL']),reference:z.string().trim().min(3).max(120),confirmed:z.literal(true),expectedPaymentId:z.uuid().nullable().optional(),replaceActivePlan:z.boolean().optional()}).strict();
export async function activateManualPayment(auth:AuthService,ctx:AuthContext,businessId:string,input:z.infer<typeof manualPaymentSchema>){
 try{return await auth.transaction(async tx=>{
  const {user}=await requirePlatform(auth,tx,ctx);await lockCapacity(tx,businessId);
  const prior=await tx.manualSubscriptionPayment.findUnique({where:{requestKey:input.requestKey}});
  if(prior){if(prior.businessId!==businessId||prior.planId!==input.planId||prior.method!==input.method||prior.reference!==input.reference)throw new ApiError(409,'PAYMENT_CONFLICT','Request already used for another payment');return prior;}
  const business=await tx.business.findUnique({where:{id:businessId}}),plan=await tx.billingPlan.findUnique({where:{id:input.planId}});
  if(!business)throw new ApiError(404,'NOT_FOUND','Business not found');
  if(business.suspendedAt)throw new ApiError(409,'BUSINESS_SUSPENDED','Resolve business suspension first');
  if(!plan?.published||!plan.priceMinor||!['MONTH','YEAR'].includes(plan.interval))throw new ApiError(409,'PLAN_UNAVAILABLE','Choose a published paid plan');
  const checkout=await tx.billingCheckout.findUnique({where:{businessId}});
  if(checkout)throw new ApiError(409,'PROVIDER_CHECKOUT_EXISTS','Reconcile the existing PayPal checkout before recording an external payment');
  const now=new Date(),latest=await tx.manualSubscriptionPayment.findFirst({where:{businessId,supersededAt:null},orderBy:{endsAt:'desc'}});
  const switching=!!latest&&latest.endsAt>now&&latest.planId!==plan.id;
  if(input.expectedPaymentId!==undefined&&input.expectedPaymentId!==(latest?.id??null))throw new ApiError(409,'REVISION_CONFLICT','Payment changed; reload');
  if(switching&&(!input.replaceActivePlan||input.expectedPaymentId!==latest.id))throw new ApiError(409,'PLAN_CHANGE_CONFIRMATION_REQUIRED','Confirm replacing the current paid term');
  const usage=await memberUsage(tx,businessId);
  const shops=await tx.location.count({where:{businessId,kind:'SHOP',archivedAt:null}});
  const warehouses=await tx.location.count({where:{businessId,kind:'WAREHOUSE',archivedAt:null}});
  if(usage.reservedMembers>plan.maxMembers||shops>plan.maxShops||warehouses>plan.maxWarehouses)throw new ApiError(409,'PLAN_CAPACITY_EXCEEDED','Selected plan cannot accommodate current stores, warehouses, members and pending invitations');
  const replaced=switching?await tx.manualSubscriptionPayment.findMany({where:{businessId,supersededAt:null,endsAt:{gt:now}},select:{id:true,planId:true}}):[];
  if(switching)await tx.manualSubscriptionPayment.updateMany({where:{id:{in:replaced.map(p=>p.id)}},data:{supersededAt:now}});
  const startsAt=!switching&&latest&&latest.endsAt>now?latest.endsAt:now,endsAt=new Date(startsAt),day=startsAt.getUTCDate();
  endsAt.setUTCDate(1);endsAt.setUTCMonth(endsAt.getUTCMonth()+(plan.interval==='YEAR'?12:1));
  const last=new Date(Date.UTC(endsAt.getUTCFullYear(),endsAt.getUTCMonth()+1,0)).getUTCDate();endsAt.setUTCDate(Math.min(day,last));
  const row=await tx.manualSubscriptionPayment.create({data:{businessId,planId:plan.id,actorId:user.id,requestKey:input.requestKey,method:input.method,reference:input.reference,amountMinor:plan.priceMinor,currency:plan.currency,paidAt:now,startsAt,endsAt}});
  await tx.billingAudit.create({data:{actorId:user.id,businessId,planId:plan.id,action:switching?'subscription.plan_changed':'subscription.manually_activated',changes:{replacedPayments:replaced,creditMinor:0,paymentId:row.id,method:row.method,reference:row.reference,amountMinor:row.amountMinor,currency:row.currency,startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString()}}});
  return row;
 });}catch(error){if((error as {code?:string}).code==='P2002')throw new ApiError(409,'PAYMENT_CONFLICT','This payment reference has already been recorded');throw error;}
}

export async function activateProviderPayment(auth:AuthService,ctx:AuthContext,businessId:string,input:{revision:number;transactionId:string;confirmed:true}){
 return auth.transaction(async tx=>{
  const {user}=await requirePlatform(auth,tx,ctx);await lockCapacity(tx,businessId);
  const checkout=await tx.billingCheckout.findUnique({where:{businessId}}),business=await tx.business.findUnique({where:{id:businessId}});
  if(!checkout||!business)throw new ApiError(404,'NOT_FOUND','Checkout not found');
  if(business.suspendedAt||checkout.accessHold||checkout.reconciliationError)throw new ApiError(409,'PAYMENT_REVIEW_REQUIRED','Resolve the payment or access hold first');
  if(checkout.activatedTransaction===input.transactionId&&checkout.paidTransaction===input.transactionId)return {ok:true};
  if(checkout.revision!==input.revision||checkout.paidTransaction!==input.transactionId)throw new ApiError(409,'REVISION_CONFLICT','Payment changed; reload');
  const receipt=await tx.billingReceipt.findUnique({where:{scope_transactionId:{scope:checkout.scope,transactionId:input.transactionId}}});
  if(!receipt||receipt.checkoutId!==checkout.id||!checkout.paidFrom||!checkout.paidUntil||checkout.paidUntil<=new Date()||!['ACTIVE','CANCELLED','SUSPENDED'].includes(checkout.providerStatus??''))throw new ApiError(409,'PAYMENT_REVIEW_REQUIRED','A verified current payment is required');
  const approval=await tx.paidApproval.findUnique({where:{businessId_planId:{businessId,planId:checkout.planId}}});
  if(approval?.status!=='APPROVED')throw new ApiError(409,'PAID_APPROVAL_REQUIRED','Approve the subscription request first');
  const updated=await tx.billingCheckout.updateMany({where:{id:checkout.id,revision:input.revision,paidTransaction:input.transactionId},data:{activatedTransaction:input.transactionId,revision:{increment:1}}});
  if(!updated.count)throw new ApiError(409,'REVISION_CONFLICT','Payment changed; reload');
  await tx.billingAudit.create({data:{actorId:user.id,businessId,planId:checkout.planId,action:'subscription.payment_activated',changes:{transactionId:input.transactionId,receiptId:receipt.id,paidUntil:checkout.paidUntil.toISOString()}}});return {ok:true};
 });
}
