import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '../generated/prisma/client.js';
import {AuthService} from '../auth/service.js';
import type {AuthSettings} from '../auth/settings.js';
import {encrypt} from '../auth/crypto.js';
import {currencyDigits} from '../sales/money.js';
import {fixed,scaled} from '../operations/decimal.js';
import {billingState} from '../billing/entitlements.js';
import {reportRecipient} from './delivery-access.js';
import {summaryTotals} from './service.js';
const copy={
 en:{title:'Business report',SALES:'Sales',GROSS_PROFIT:'Gross profit',NET_PROFIT:'Estimated net profit',EXPENSES:'Expenses',RETURNS:'Returns',CASH:'Cash closing',saleCount:'Completed sales',sales:'Sales including tax',customerReturns:'Customer return credits',netSales:'Sales after returns (including tax)',netTax:'Net sales tax',grossProfit:'Gross profit excluding tax',estimatedProfit:'Estimated net profit',expenses:'Recorded expenses',estimatedCost:'Net cost of goods sold',damageCost:'Damage cost',transferLossCost:'Transfer-loss cost',countAdjustmentValue:'Inventory count gain / loss',closeCount:'Closed days / locations',opening:'Total opening cash',expected:'Total expected cash',counted:'Total counted cash',variance:'Total cash variance',all:'All permitted locations',unavailable:'Unavailable',note:'Gross profit excludes sales tax and deducts the recorded net cost of goods sold. Estimated net profit also includes recorded expenses, damage, transfer losses and count adjustments. Unrecorded costs are not included.',missing:'Net profit is unavailable because some historical transfer losses have no recorded cost.',asOf:'Activity recorded by',timezone:'Business timezone',range:'Period',app:'The same report is available in the app under Dashboard & reports → Closing reports.'},
 ar:{title:'تقرير النشاط',SALES:'المبيعات',GROSS_PROFIT:'إجمالي الربح',NET_PROFIT:'صافي الربح التقديري',EXPENSES:'المصروفات',RETURNS:'المرتجعات',CASH:'الإغلاق النقدي',saleCount:'المبيعات المكتملة',sales:'المبيعات شاملة الضريبة',customerReturns:'قيمة مرتجعات العملاء',netSales:'المبيعات بعد المرتجعات شاملة الضريبة',netTax:'صافي ضريبة المبيعات',grossProfit:'إجمالي الربح دون الضريبة',estimatedProfit:'صافي الربح التقديري',expenses:'المصروفات المسجلة',estimatedCost:'صافي تكلفة البضاعة المباعة',damageCost:'تكلفة التلف',transferLossCost:'تكلفة فاقد التحويلات',countAdjustmentValue:'أرباح / خسائر الجرد',closeCount:'أيام / مواقع مغلقة',opening:'إجمالي النقد الافتتاحي',expected:'إجمالي النقد المتوقع',counted:'إجمالي النقد المعدود',variance:'إجمالي فرق النقد',all:'جميع المواقع المسموح بها',unavailable:'غير متاح',note:'إجمالي الربح يستبعد ضريبة المبيعات ويخصم صافي تكلفة البضاعة المسجلة. يشمل صافي الربح التقديري أيضاً المصروفات والتلف وفاقد التحويلات وتسويات الجرد المسجلة. لا يشمل التكاليف غير المسجلة.',missing:'صافي الربح غير متاح لوجود فاقد تحويلات تاريخي دون تكلفة مسجلة.',asOf:'الحركات المسجلة حتى',timezone:'المنطقة الزمنية للنشاط',range:'الفترة',app:'التقرير نفسه متاح داخل التطبيق ضمن لوحة المتابعة والتقارير ← تقارير الإغلاق.'}
};
export async function prepareReportBatch(db:PrismaClient,settings:AuthSettings,limit=20){
 const auth=new AuthService(db,settings);let prepared=0,failed=0,cancelled=0;
 for(let i=0;i<limit;i++){
  // Claim with a lease. A crash before preparation commits leaves a retryable job.
  const claim=await db.$transaction(async tx=>{const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM report_deliveries WHERE snapshot='' AND cancelled_at IS NULL AND attempts<8 AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;if(!rows[0])return null;return tx.reportDelivery.update({where:{id:rows[0].id},data:{attempts:{increment:1},availableAt:new Date(Date.now()+5*60000)}});});
  if(!claim)break;
  try{const result=await auth.transaction(async tx=>{
   const row=await tx.reportDelivery.findUniqueOrThrow({where:{id:claim.id}});if(row.snapshot||row.cancelledAt)return false;
   const recipient=await reportRecipient(tx,row.businessId,row.userId,row.reportTypes,row.locationId),pref=await tx.reportPreference.findUnique({where:{businessId_userId:{businessId:row.businessId,userId:row.userId}}});
   if(!recipient||row.automatic&&!pref?.enabled||!(await billingState(tx,row.businessId)).active){await tx.reportDelivery.update({where:{id:row.id},data:{cancelledAt:new Date()}});cancelled++;return false;}
   const b=recipient.business,lang=row.language==='ar'?'ar':'en',c=copy[lang];
   const bounds=await tx.$queryRaw<{start:Date;end:Date}[]>`SELECT (${row.fromDay}::date)::timestamp AT TIME ZONE ${b.timezone} AS start,(${row.toDay}::date+1)::timestamp AT TIME ZONE ${b.timezone} AS end`;
   // Inclusive cutoff to include the immutable close itself; no later activity.
   const cutoff=new Date(row.createdAt.getTime()+1),range={gte:bounds[0]!.start,lt:new Date(Math.min(bounds[0]!.end.getTime(),cutoff.getTime()))};
   const totals=await summaryTotals(tx,row.businessId,range,row.locationId?{locationId:row.locationId}:{},currencyDigits(b.baseCurrency));
   const metrics:Record<string,string|number|null>={...totals};
   if(row.reportTypes.includes('CASH')){
    const closes=await tx.cashClose.findMany({where:{businessId:row.businessId,...(row.locationId?{locationId:row.locationId}:{}),day:{gte:row.fromDay,lte:row.toDay},createdAt:{lt:cutoff}},take:1001});if(closes.length>1000)throw new Error('REPORT_TOO_LARGE');metrics.closeCount=closes.length;
    for(const key of ['opening','expected','counted','variance'] as const)metrics[key]=fixed(closes.reduce((sum,close)=>sum+scaled(close[key].toFixed(4)),0n));
   }
   const groups:Record<string,string[]>={SALES:['saleCount','sales','customerReturns','netSales','netTax'],GROSS_PROFIT:['grossProfit','estimatedCost'],NET_PROFIT:['estimatedProfit','damageCost','transferLossCost','countAdjustmentValue'],EXPENSES:['expenses'],RETURNS:['customerReturns'],CASH:['closeCount','opening','expected','counted','variance']};
   const money=new Intl.NumberFormat(lang,{style:'currency',currency:b.baseCurrency}),labels=c as Record<string,string>;
   const location=row.locationId?await tx.location.findFirstOrThrow({where:{id:row.locationId,businessId:row.businessId}}):null;
   const sections=row.reportTypes.map(type=>({type,title:labels[type],metrics:groups[type]!.map(key=>({key,label:labels[key],value:metrics[key]===null?c.unavailable:['saleCount','closeCount'].includes(key)?String(metrics[key]):money.format(Number(metrics[key]))}))}));
   const profit=row.reportTypes.some(t=>['GROSS_PROFIT','NET_PROFIT'].includes(t));
   const snapshot={title:c.title,business:b.name,location:location?.name??c.all,from:row.fromDay,to:row.toDay,timezone:b.timezone,asOf:row.createdAt.toISOString(),language:lang,currency:b.baseCurrency,sections,note:profit?(totals.unvaluedTransferLosses&&row.reportTypes.includes('NET_PROFIT')?`${c.note} ${c.missing}`:c.note):''};
   const text=[`${c.title} — ${b.name}`,snapshot.location,`${c.range}: ${row.fromDay} → ${row.toDay}`,`${c.timezone}: ${b.timezone}`,`${c.asOf}: ${new Intl.DateTimeFormat(lang,{dateStyle:'medium',timeStyle:'short',timeZone:b.timezone}).format(row.createdAt)}`,...sections.flatMap(s=>['',s.title,...s.metrics.map(m=>`${m.label}: ${m.value}`)]),'',snapshot.note,'',c.app,`${settings.appOrigin}/business-v2?tab=reports`].join('\n');
   const mailId=randomUUID();await tx.authMail.create({data:{id:mailId,reportId:row.id,payload:encrypt(settings.key,JSON.stringify({to:recipient.user.email,subject:`${c.title} — ${b.name} — ${row.toDay}`,text}),`mail:${mailId}`)}});
   await tx.reportDelivery.update({where:{id:row.id},data:{snapshot:encrypt(settings.key,JSON.stringify(snapshot),`report:${row.id}`),failureCode:null}});return true;
  });if(result)prepared++;}
  catch{failed++;await db.reportDelivery.updateMany({where:{id:claim.id,snapshot:''},data:{failureCode:'REPORT_PREPARATION_FAILED',availableAt:new Date(Date.now()+Math.min(60,2**claim.attempts)*60000)}});}
 }
 return {prepared,failed,cancelled};
}
