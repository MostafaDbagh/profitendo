import { currencyFormatter } from '../../lib/currencyFormat';
const fields={code:'code',name:'nameEn',nameAr:'nameAr',priceMinor:'price',currency:'currency',interval:'interval',trialDays:'trialDays',maxMembers:'maxMembers',maxWarehouses:'maxWarehouses',maxShops:'maxShops'};
const paymentFields={paymentId:'auditPaymentId',method:'auditPaymentMethod',reference:'receiptReference',amountMinor:'receiptAmount',currency:'currency',startsAt:'auditStartsAt',endsAt:'auditEndsAt',creditMinor:'auditCredit',transactionId:'auditTransactionId',receiptId:'auditReceiptId',paidUntil:'auditEndsAt'};
function PaymentDetails({changes,c,lang}){
 const money=v=>currencyFormatter(lang,{style:'currency',currency:changes.currency||'USD'}).format(v/100);
 const value=(key,v)=>{
  if(v===null||v===undefined)return '—';
  if(['amountMinor','creditMinor'].includes(key))return money(v);
  if(['startsAt','endsAt','paidUntil'].includes(key))return new Date(v).toLocaleString(lang);
  if(key==='method')return v==='SHAM_CASH'?c('auditShamCash'):v==='PAYPAL'?'PayPal':String(v);
  return String(v);
 };
 return <dl className="space-y-1 break-words">{Object.entries(paymentFields).filter(([key])=>key in changes).map(([key,label])=><div key={key}><dt className="inline font-medium">{c(label)}: </dt><dd className="inline"><bdi>{value(key,changes[key])}</bdi></dd></div>)}{Array.isArray(changes.replacedPayments)&&changes.replacedPayments.length>0&&<div><dt className="font-medium">{c('auditReplacedPayments')}:</dt><dd><ul className="space-y-2 mt-1">{changes.replacedPayments.map(payment=><li key={payment.id}>{c('auditPaymentId')}: <bdi>{payment.id}</bdi><br/>{c('auditPlanId')}: <bdi>{payment.planId}</bdi></li>)}</ul></dd></div>}</dl>;
}
export default function AuditDetails({row,c,lang}){
 const changes=row.changes||{};
 if(['subscription.plan_changed','subscription.manually_activated','subscription.payment_activated'].includes(row.action))return <PaymentDetails {...{changes,c,lang}}/>;
 const value=(k,v,source)=>k==='priceMinor'?(v===null?c('trialOnly'):currencyFormatter(lang,{style:'currency',currency:source.currency||'USD'}).format(v/100)):k==='interval'?c(v):String(v??'—');
 if(changes.reason)return <p className="break-words">{changes.reason}</p>;
 if(typeof changes.before==='boolean')return <p>{c(changes.before?'published':'draft')} → {c(changes.after?'published':'draft')}</p>;
 const current=changes.after&&typeof changes.after==='object'?changes.after:changes;
 const keys=Object.keys(fields).filter(k=>k in current&&(!changes.before||current[k]!==changes.before[k]));
 return keys.length?<dl className="space-y-1">{keys.map(k=><div key={k}><dt className="inline font-medium">{c(fields[k])}: </dt><dd className="inline">{changes.before&&<>{c('before')} {value(k,changes.before[k],changes.before)} · {c('after')} </>}{value(k,current[k],current)}</dd></div>)}</dl>:<span>—</span>;
}
