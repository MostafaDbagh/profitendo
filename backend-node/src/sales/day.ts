import type {AuthContext,AuthService} from '../auth/service.js';
import {locationScope} from '../workflows/shared.js';
import {businessDay} from '../finance/cash.js';
import {currencyDigits} from './money.js';
export async function mySalesDay(auth:AuthService,ctx:AuthContext,businessId:string){return auth.transaction(async tx=>{
 const {access,where}=await locationScope(auth,tx,ctx,businessId,'sales.view');
 const day=businessDay(new Date(),access.business.timezone);
 const bounds=await tx.$queryRaw<{start:Date;end:Date}[]>`SELECT (${day}::date)::timestamp AT TIME ZONE ${access.business.timezone} AS start,(${day}::date+1)::timestamp AT TIME ZONE ${access.business.timezone} AS end`;
 const completedAt={gte:bounds[0]!.start,lt:bounds[0]!.end};
 const payments=await tx.salePayment.groupBy({by:['method'],where:{businessId,actorId:access.user.id,sale:{...where,status:'COMPLETED',completedAt}},_sum:{amount:true,received:true,change:true},_count:true});
 const draftCount=await tx.sale.count({where:{...where,status:'DRAFT',actorId:access.user.id}});
 const pendingReturns=access.permissions['returns.view']?await tx.adjustment.count({where:{...where,kind:'CUSTOMER_RETURN',status:'DRAFT',actorId:access.user.id}}):undefined;
 const approvedReturns=access.permissions['returns.view']?await tx.adjustment.aggregate({where:{...where,kind:'CUSTOMER_RETURN',status:'COMPLETED',actorId:access.user.id,completedAt},_sum:{total:true},_count:true}):undefined;
 return {day,timezone:access.business.timezone,currency:access.business.baseCurrency,currencyDigits:currencyDigits(access.business.baseCurrency),draftCount,pendingReturns,approvedReturnCount:approvedReturns?approvedReturns._count:undefined,approvedReturnCredit:approvedReturns?approvedReturns._sum.total?.toFixed(4)??'0.0000':undefined,payments:payments.map(p=>({method:p.method,count:p._count,amount:p._sum.amount?.toFixed(4)??'0.0000',received:p._sum.received?.toFixed(4)??'0.0000',change:p._sum.change?.toFixed(4)??'0.0000'}))};
});}
