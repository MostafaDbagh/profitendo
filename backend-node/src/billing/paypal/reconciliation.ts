import type { AuthService } from '../../auth/service.js';
import type { PayPalProvider } from './client.js';
import { assertBinding, assertPlanTerms, minorUnits, transactionsSchema } from './contracts.js';
import { ApiError } from '../../errors.js';
// Browser approval and webhook arrival time are never proof of a paid period.
export async function reconcileCheckout(auth:AuthService,provider:PayPalProvider,id:string,now=new Date()){
 const intent=await auth.db.billingCheckout.findUniqueOrThrow({where:{id},include:{plan:true}});
 if(intent.scope!==provider.scope||!intent.providerSubscriptionId||!provider.getTransactions)throw new ApiError(409,'RECONCILIATION_UNAVAILABLE','Provider reconciliation unavailable');
 const snapshot=await provider.getSubscription(intent.providerSubscriptionId);assertBinding(snapshot,intent);
 assertPlanTerms(await provider.getPlan(intent.providerPlanId),intent.plan,{allowInactive:true});
 const last=snapshot.billing_info?.last_payment,next=snapshot.billing_info?.next_billing_time;
 let from:Date|null=null,until:Date|null=null,transaction:string|null=null,hold=intent.accessHold;
 let receipt:{id:string;paidAt:Date}|null=null;
 // Query around the provider's last payment, not an inferred billing period.
 if(last){
  const paidAt=new Date(last.time);
  if(paidAt>now)throw new ApiError(409,'PAYMENT_REVIEW_REQUIRED','Future payment date');
  const result=transactionsSchema.parse(await provider.getTransactions(intent.providerSubscriptionId,new Date(paidAt.getTime()-86400000),new Date(Math.min(now.getTime(),paidAt.getTime()+86400000))));
  const matching=result.transactions.filter(t=>new Date(t.time).getTime()===paidAt.getTime()&&minorUnits(t.amount_with_breakdown.gross_amount.value)===intent.plan.priceMinor&&t.amount_with_breakdown.gross_amount.currency_code===intent.plan.currency);
  if(matching.length!==1||minorUnits(last.amount.value)!==intent.plan.priceMinor||last.amount.currency_code!==intent.plan.currency)throw new ApiError(409,'PAYMENT_REVIEW_REQUIRED','Payment does not match the plan');
  const payment=matching[0]!;
  if(['REFUNDED','PARTIALLY_REFUNDED','FAILED','DECLINED'].includes(payment.status))hold=true;
  if(payment.status==='COMPLETED')receipt={id:payment.id,paidAt};
  if(intent.paidFrom&&paidAt<intent.paidFrom)throw new ApiError(409,'PAYMENT_REVIEW_REQUIRED','Payment history moved backwards');
  if(payment.status==='COMPLETED'&&next&&snapshot.status==='ACTIVE'&&snapshot.billing_info?.failed_payments_count===0&&snapshot.billing_info.outstanding_balance?.currency_code===intent.plan.currency&&minorUnits(snapshot.billing_info.outstanding_balance.value)===0){
   const end=new Date(next),maxDays=intent.plan.interval==='YEAR'?367:32;
   if(end<=paidAt||end.getTime()-paidAt.getTime()>maxDays*86400000)throw new ApiError(409,'PAYMENT_REVIEW_REQUIRED','Unexpected provider billing period');
   // The same payment can never extend its original verified entitlement.
   if(intent.paidTransaction!==payment.id){from=paidAt;until=end;transaction=payment.id;}
  }
 }
 await auth.transaction(async tx=>{
  const current=await tx.billingCheckout.findUniqueOrThrow({where:{id}});
  if(current.revision!==intent.revision)throw new ApiError(409,'CHECKOUT_CHANGED','Retry reconciliation');
  if(current.providerUpdatedAt&&new Date(snapshot.status_update_time)<current.providerUpdatedAt)throw new ApiError(409,'CHECKOUT_CHANGED','Provider returned stale state');
  if(receipt){
    const existing=await tx.billingReceipt.findUnique({where:{scope_transactionId:{scope:provider.scope,transactionId:receipt.id}}});
    if(existing&&(existing.checkoutId!==id||existing.amountMinor!==intent.plan.priceMinor||existing.currency!==intent.plan.currency||existing.paidAt.getTime()!==receipt.paidAt.getTime()))throw new ApiError(409,'PAYMENT_REVIEW_REQUIRED','Payment is already bound to different terms');
    if(!existing)await tx.billingReceipt.create({data:{checkoutId:id,scope:provider.scope,transactionId:receipt.id,eventId:`reconciliation:${receipt.id}`,amountMinor:intent.plan.priceMinor!,currency:intent.plan.currency,paidAt:receipt.paidAt}});
  }
  if(transaction||hold!==current.accessHold)await tx.authAudit.create({data:{businessId:intent.businessId,action:'billing.reconciled',targetId:id,changes:{accessHold:hold,paidUntil:until?.toISOString()??current.paidUntil?.toISOString()??null}}});
  await tx.billingCheckout.update({where:{id},data:{nextBillingAt:snapshot.status==='ACTIVE'&&next?new Date(next):null,providerStatus:snapshot.status,providerUpdatedAt:new Date(snapshot.status_update_time),reconciledAt:now,reconciliationError:null,accessHold:hold,revision:{increment:1},...(from&&until&&transaction?{paidFrom:from,paidUntil:until,paidTransaction:transaction}:{})}});
 });
 return {ok:true};
}
export async function reconcileBatch(auth:AuthService,provider:PayPalProvider,limit=20){
 const rows=await auth.db.billingCheckout.findMany({where:{scope:provider.scope,providerSubscriptionId:{not:null}},orderBy:[{reconciledAt:{sort:'asc',nulls:'first'}},{id:'asc'}],take:limit});let reconciled=0,failed=0;
 for(const row of rows)try{await reconcileCheckout(auth,provider,row.id);reconciled++;}catch(e){
  const code=e instanceof ApiError?e.code:'RECONCILIATION_FAILED';
  await auth.db.billingCheckout.updateMany({where:{id:row.id,revision:row.revision},data:{reconciledAt:new Date(),reconciliationError:code,...(['PAYMENT_REVIEW_REQUIRED','PROVIDER_BINDING_MISMATCH','PROVIDER_PLAN_MISMATCH'].includes(code)?{accessHold:true}:{}),revision:{increment:1}}});failed++;
 }
 return {reconciled,failed};
}
