import type {AuthService,AuthContext} from '../auth/service.js';
import {requireBusiness} from '../businesses/access.js';
import {ApiError} from '../errors.js';
import {fixed,scaled} from '../operations/decimal.js';
import {csvCell} from '../reports/service.js';
export type InsightQuery={page:number;search?:string;state:'active'|'inactive'|'all';filter:'all'|'low'|'top';export:boolean};
export async function productInsights(auth:AuthService,ctx:AuthContext,businessId:string,q:InsightQuery){return auth.transaction(async tx=>{
 const a=await requireBusiness(auth,tx,ctx,businessId,'catalogue.view');
 const stock=a.permissions['inventory.view']&&a.permissions['locations.view'],sales=a.permissions['sales.view']&&a.permissions['locations.view'];
 if((q.filter==='low'&&!stock)||(q.filter==='top'&&!sales))throw new ApiError(403,'FORBIDDEN','Permission required');
 const scope={businessId,...(a.permissions['locations.all']?{}:{assignments:{some:{businessId,membershipId:a.membership.id}}})};
 const locations=stock||sales?await tx.location.findMany({where:scope,select:{id:true,name:true,archivedAt:true}}):[];
 const active=locations.filter(l=>!l.archivedAt),locationIds=locations.map(l=>l.id);
 const products=await tx.product.findMany({where:{businessId,...(q.state==='all'?{}:{active:q.state==='active'}),...(q.search?{OR:[{name:{contains:q.search,mode:'insensitive' as const}},{sku:{contains:q.search,mode:'insensitive' as const}},{barcodes:{some:{value:q.search}}}]}:{})},include:{barcodes:true},orderBy:[{name:'asc'},{id:'asc'}],take:10001});
 if(products.length>10000)throw new ApiError(422,'REPORT_TOO_LARGE','Narrow the product search');
 const ids=products.map(p=>p.id);
 const balances=stock?await tx.stockBalance.findMany({where:{businessId,productId:{in:ids},locationId:{in:active.map(l=>l.id)}}}):[];
 const sold=sales?await tx.saleLine.groupBy({by:['productId','saleId'],where:{businessId,productId:{in:ids},sale:{businessId,status:'COMPLETED',locationId:{in:locationIds}}},_sum:{baseQuantity:true},orderBy:[{productId:'asc'},{saleId:'asc'}],take:100001}):[];
 if(sold.length>100000)throw new ApiError(422,'REPORT_TOO_LARGE','Sales history exceeds report limit');
 const counts=new Map<string,{count:number;units:bigint}>();for(const row of sold){const old=counts.get(row.productId)??{count:0,units:0n};old.count++;old.units+=scaled(row._sum.baseQuantity?.toFixed(4)??'0');counts.set(row.productId,old);}
 const balanceMap=new Map(balances.map(b=>[`${b.productId}:${b.locationId}`,b]));
 let rows=products.map(p=>{const {purchasePrice,sellingPrice,minimumStock,barcodes,...rest}=p;let available=0n;const lowLocations: {id:string;name:string;available:string}[]=[];
  if(stock)for(const location of active){const b=balanceMap.get(`${p.id}:${location.id}`),qty=b?scaled(b.onHand.toFixed(4))-scaled(b.reserved.toFixed(4)):0n;available+=qty;if(p.active&&qty<=scaled(minimumStock.toFixed(4)))lowLocations.push({id:location.id,name:location.name,available:fixed(qty)});}
  return {...rest,barcodes:barcodes.map(b=>b.value),sellingPrice:sellingPrice.toFixed(4),minimumStock:minimumStock.toFixed(4),...(a.permissions['catalogue.cost']?{purchasePrice:purchasePrice.toFixed(4)}:{}),...(stock?{available:fixed(available),lowStock:lowLocations.length>0,lowLocations}:{}),...(sales?{saleCount:counts.get(p.id)?.count??0,unitsSold:fixed(counts.get(p.id)?.units??0n)}:{})};});
 if(q.filter==='low')rows=rows.filter(p=>p.lowStock);
 if(q.filter==='top')rows=rows.filter(p=>(p.saleCount??0)>0).sort((a,b)=>(b.saleCount??0)-(a.saleCount??0)||a.sku.localeCompare(b.sku)).slice(0,10);
 if(q.export){const headers=['name','sku','unit','sellingPrice',...(a.permissions['catalogue.cost']?['purchasePrice']:[]),...(sales?['saleCount','unitsSold']:[]),...(stock?['available','minimumStock','lowStock']:[])];return {filename:'products.csv',csv:[headers.map(csvCell).join(','),...rows.map(p=>headers.map(h=>csvCell((p as unknown as Record<string,unknown>)[h])).join(','))].join('\r\n')};}
 return {page:q.page,pageSize:25,total:rows.length,currency:a.business.baseCurrency,items:rows.slice((q.page-1)*25,q.page*25)};
});}
