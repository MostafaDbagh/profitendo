import type {AuthService,AuthContext} from '../auth/service.js';
import {requireLocation} from '../locations/access.js';
import {locationScope,fail} from '../workflows/shared.js';
import {fixed,scaled} from '../operations/decimal.js';
import {currencyDigits,lineGross} from '../sales/money.js';
export type ReportQuery={from:string;to:string;locationId?:string;view:'summary'|'stock'|'sales'|'purchases'|'returns'|'payments'|'balances'|'refunds';page:number;lowStock:boolean;export:boolean};
export function csvCell(v:unknown){let s=v==null?'':String(v);if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export class ReportService{
 constructor(readonly auth:AuthService){}
 async read(ctx:AuthContext,bid:string,q:ReportQuery){return this.auth.transaction(async tx=>{
  const {where,access}=await locationScope(this.auth,tx,ctx,bid,'reports.view');if(q.locationId)await requireLocation(this.auth,tx,ctx,bid,q.locationId,'reports.view',false);
  const scoped={...where,...(q.locationId?{locationId:q.locationId}:{})},cost=access.permissions['catalogue.cost'],purchase=cost&&access.permissions['purchasing.view'],currency=access.business.baseCurrency,digits=currencyDigits(currency);
  const calendarDays=(new Date(q.to).getTime()-new Date(q.from).getTime())/86400000+1;
  if(calendarDays<1||calendarDays>366)fail('REPORT_RANGE',422);
  const bounds=await tx.$queryRaw<{start:Date;end:Date}[]>`SELECT (${q.from}::date)::timestamp AT TIME ZONE ${access.business.timezone} AS start,(${q.to}::date+1)::timestamp AT TIME ZONE ${access.business.timezone} AS end`;
  const range={gte:bounds[0]!.start,lt:bounds[0]!.end};
  const base={currency,currencyDigits:digits,from:q.from,to:q.to,timeBasis:access.business.timezone};
  const limit=10000;
  if(q.view==='summary'){
   // A transaction uses one connection; finish each query before starting the next.
   const sales=await tx.sale.findMany({where:{...scoped,status:'COMPLETED',completedAt:range},include:{lines:true},take:limit+1});
   const returns=await tx.adjustment.findMany({where:{...scoped,status:'COMPLETED',completedAt:range,kind:{in:['CUSTOMER_RETURN','SUPPLIER_RETURN','DAMAGE','COUNT']}},include:{lines:true},take:limit+1});
   const entries=await tx.moneyEntry.findMany({where:{...scoped,createdAt:range},take:limit+1});
   if([sales,returns,entries].some(r=>r.length>limit))fail('REPORT_TOO_LARGE',422);
   const sold=sales.reduce((s,d)=>s+scaled(d.total.toFixed(4)),0n),customerReturns=returns.filter(d=>d.kind==='CUSTOMER_RETURN').reduce((s,d)=>s+scaled(d.total.toFixed(4)),0n),expenses=entries.filter(e=>e.kind==='EXPENSE').reduce((s,e)=>s+scaled(e.amount.toFixed(4)),0n);
   const saleCost=sales.reduce((s,d)=>s+d.lines.reduce((a,l)=>a+scaled(lineGross(l.baseQuantity.toFixed(4),l.unitCost.toFixed(4),digits)),0n),0n),recoveredCost=returns.filter(d=>d.kind==='CUSTOMER_RETURN').reduce((s,d)=>s+d.lines.filter(l=>l.condition==='RESTOCK').reduce((a,l)=>a+scaled(lineGross(l.quantity.toFixed(4),l.unitCost.toFixed(4),digits)),0n),0n),damageCost=returns.filter(d=>d.kind==='DAMAGE').reduce((s,d)=>s+d.lines.reduce((a,l)=>a+scaled(lineGross(l.quantity.toFixed(4),l.unitCost.toFixed(4),digits)),0n),0n);
   const countAdjustmentValue=returns.filter(d=>d.kind==='COUNT').reduce((sum,d)=>sum+d.lines.reduce((value,l)=>{
    const delta=scaled(l.delta.toFixed(4));
    const amount=scaled(lineGross(fixed(delta<0n?-delta:delta),l.unitCost.toFixed(4),digits));
    return value+(delta<0n?-amount:amount);
   },0n),0n);
   const low=await tx.stockBalance.count({where:{...scoped,onHand:{lte:0}}});
   return {...base,saleCount:sales.length,sales:fixed(sold),customerReturns:fixed(customerReturns),netSales:fixed(sold-customerReturns),expenses:access.permissions['payments.view']?fixed(expenses):undefined,zeroStockProducts:low,...(cost&&access.permissions['payments.view']?{estimatedProfit:fixed(sold-customerReturns-saleCost+recoveredCost-damageCost-expenses+countAdjustmentValue),estimatedCost:fixed(saleCost-recoveredCost),damageCost:fixed(damageCost),countAdjustmentValue:fixed(countAdjustmentValue)}:{})};
  }
  if((q.view==='purchases'||q.view==='balances')&&!purchase)fail('FORBIDDEN',403);if((q.view==='payments'||q.view==='refunds')&&!access.permissions['payments.view'])fail('FORBIDDEN',403);
  let rows:Record<string,unknown>[]=[];
  let pagedTotal:number|undefined;
  const paging={skip:q.export?0:(q.page-1)*25,take:q.export?limit+1:25};
  if(q.view==='stock'){
   if(!q.export&&!q.lowStock)pagedTotal=await tx.stockBalance.count({where:scoped});
   const data=await tx.stockBalance.findMany({where:scoped,include:{product:true,location:{select:{name:true}}},orderBy:[{locationId:'asc'},{productId:'asc'}],...(q.lowStock?{skip:0,take:limit+1}:paging)});if(data.length>limit)fail('REPORT_TOO_LARGE',422);
   rows=data.filter(r=>!q.lowStock||r.onHand.minus(r.reserved).lte(r.product.minimumStock)).map(r=>({location:r.location.name,sku:r.product.sku,product:r.product.name,unit:r.product.unit,onHand:r.onHand.toFixed(4),reserved:r.reserved.toFixed(4),available:fixed(scaled(r.onHand.toFixed(4))-scaled(r.reserved.toFixed(4))),minimum:r.product.minimumStock.toFixed(4),...(cost?{estimatedValue:lineGross(r.onHand.toFixed(4),r.product.purchasePrice.toFixed(4),digits)}:{})}));
  }else if(q.view==='sales'){
   const where={...scoped,status:'COMPLETED' as const,completedAt:range};
   if(!q.export)pagedTotal=await tx.sale.count({where});
   rows=(await tx.sale.findMany({where,orderBy:[{completedAt:'desc'},{id:'asc'}],...paging})).map(r=>({reference:r.reference,location:r.locationName,date:r.completedAt?.toISOString(),customer:r.customerName,total:r.total.toFixed(digits),currency:r.currency}));
  }else if(q.view==='returns'){
   const where={...scoped,status:'COMPLETED',completedAt:range,kind:{in:purchase?['CUSTOMER_RETURN','SUPPLIER_RETURN']:['CUSTOMER_RETURN']}};
   if(!q.export)pagedTotal=await tx.adjustment.count({where});
   rows=(await tx.adjustment.findMany({where,orderBy:[{completedAt:'desc'},{id:'asc'}],...paging})).map(r=>({reference:r.reference,location:r.locationName,kind:r.kind,source:r.sourceReference,date:r.completedAt?.toISOString(),credit:r.total.toFixed(digits),currency:r.currency}));
  }else if(q.view==='payments'){
   const where={...scoped,createdAt:range,...(!purchase?{kind:{notIn:['SUPPLIER_PAYMENT','SUPPLIER_REFUND']}}:{})};
   if(!q.export)pagedTotal=await tx.moneyEntry.count({where});
   rows=(await tx.moneyEntry.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],...paging})).map(r=>({reference:r.reference,kind:r.kind,method:r.method,date:r.createdAt.toISOString(),amount:r.amount.toFixed(digits),currency:r.currency,reason:r.reason}));
  }
  else if(q.view==='refunds'){
   const refundWhere={...scoped,kind:'CUSTOMER_RETURN',status:'COMPLETED'};
   if(!q.export)pagedTotal=await tx.adjustment.count({where:refundWhere});
   const returns=await tx.adjustment.findMany({where:refundWhere,orderBy:[{completedAt:'desc'},{id:'asc'}],...paging});if(returns.length>limit)fail('REPORT_TOO_LARGE',422);
   const paid=await tx.moneyEntry.groupBy({by:['sourceId'],where:{businessId:bid,sourceId:{in:returns.map(r=>r.id)},kind:'CUSTOMER_REFUND'},_sum:{amount:true}});
   const paidBySource=new Map(paid.map(p=>[p.sourceId,p._sum.amount?.toFixed(4)??'0']));
   rows=returns.map(r=>{const refund=scaled(paidBySource.get(r.id)??'0');return {reference:r.reference,source:r.sourceReference,location:r.locationName,credit:r.total.toFixed(digits),paid:fixed(refund),outstanding:fixed(scaled(r.total.toFixed(4))-refund),currency:r.currency};});
  }
  else{
   const receiptWhere={...scoped,kind:'RECEIPT',status:'COMPLETED',...(q.view==='purchases'?{completedAt:range}:{})};
   if(!q.export)pagedTotal=await tx.purchaseDocument.count({where:receiptWhere});
   const receipts=await tx.purchaseDocument.findMany({where:receiptWhere,include:{lines:true},orderBy:[{completedAt:'desc'},{id:'asc'}],...paging});if(receipts.length>limit)fail('REPORT_TOO_LARGE',422);
   const receiptIds=receipts.map(r=>r.id);const credits=q.view==='balances'?await tx.adjustment.groupBy({by:['sourceId'],where:{businessId:bid,sourceId:{in:receiptIds},status:'COMPLETED',kind:'SUPPLIER_RETURN'},_sum:{total:true}}):[],payments=q.view==='balances'?await tx.moneyEntry.groupBy({by:['sourceId','kind'],where:{businessId:bid,sourceId:{in:receiptIds},kind:{in:['SUPPLIER_PAYMENT','SUPPLIER_REFUND']}},_sum:{amount:true}}):[];
   const creditsBySource=new Map(credits.map(c=>[c.sourceId,c._sum.total?.toFixed(4)??'0'])),paymentsBySource=new Map(payments.map(p=>[`${p.sourceId}:${p.kind}`,p._sum.amount?.toFixed(4)??'0']));
   for(const r of receipts){const total=r.lines.reduce((s,l)=>s+scaled(lineGross(l.baseQuantity.toFixed(4),l.unitCost.toFixed(4),digits)),0n);if(q.view==='balances'){const credit=scaled(creditsBySource.get(r.id)??'0'),paid=scaled(paymentsBySource.get(`${r.id}:SUPPLIER_PAYMENT`)??'0'),refunded=scaled(paymentsBySource.get(`${r.id}:SUPPLIER_REFUND`)??'0'),remaining=total-credit-paid+refunded;rows.push({reference:r.reference,supplier:r.supplierName,location:r.locationName,total:fixed(total),credit:fixed(credit),paid:fixed(paid),refundReceived:fixed(refunded),outstanding:fixed(remaining>0n?remaining:0n),refundDue:fixed(remaining<0n?-remaining:0n),currency:r.currency});}else rows.push({reference:r.reference,supplier:r.supplierName,location:r.locationName,date:r.completedAt?.toISOString(),total:fixed(total),currency:r.currency});}
  }
  if(rows.length>limit)fail('REPORT_TOO_LARGE',422);
  if(q.export){const headers=Object.keys(rows[0]??{}),csv=[headers.map(csvCell).join(','),...rows.map(r=>headers.map(h=>csvCell(r[h])).join(','))].join('\r\n');await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'report.exported',changes:{view:q.view,rowCount:rows.length}}});return {...base,filename:`${q.view}-${q.from}-${q.to}.csv`,csv,total:rows.length};}
  return {...base,headers:Object.keys(rows[0]??{}),page:q.page,pageSize:25,total:pagedTotal??rows.length,items:pagedTotal===undefined?rows.slice((q.page-1)*25,q.page*25):rows};
 });}
}
