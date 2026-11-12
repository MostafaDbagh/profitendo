import { baseUnits, validateReferences } from './references.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthService, AuthContext, Tx } from '../auth/service.js';
import { encrypt, decrypt } from '../auth/crypto.js';
import { requireBusiness } from '../businesses/access.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError } from '../errors.js';
import { productSchema, type ProductInput } from './contracts.js';
import { columns, parseWorkbook } from './workbook.js';
type Issue={row:number;field:string;code:string};
type Parsed={row:number;product:ProductInput};
async function access(auth:AuthService,tx:Tx,ctx:AuthContext,businessId:string){
  const result=await requireBusiness(auth,tx,ctx,businessId,'catalogue.manage');
  if(!result.permissions['catalogue.cost'])throw new ApiError(403,'FORBIDDEN','Purchase-cost permission is required');
  return result;
}
async function conflicts(tx:Tx,businessId:string,rows:Parsed[]):Promise<Issue[]>{
  const issues:Issue[]=[],skus=new Set<string>(),barcodes=new Set<string>();
  const products=await tx.product.findMany({where:{businessId,sku:{in:rows.map(r=>r.product.sku)}},select:{sku:true}});
  const existing=await tx.productBarcode.findMany({where:{businessId,value:{in:rows.flatMap(r=>r.product.barcodes)}},select:{value:true}});
  const usedSkus=new Set(products.map(p=>p.sku)),usedBarcodes=new Set(existing.map(b=>b.value));
  for(const {row,product} of rows){
    if(skus.has(product.sku)||usedSkus.has(product.sku))issues.push({row,field:'sku',code:'IDENTIFIER_EXISTS'});
    skus.add(product.sku);
    for(const value of product.barcodes){if(barcodes.has(value)||usedBarcodes.has(value))issues.push({row,field:'barcodes',code:'IDENTIFIER_EXISTS'});barcodes.add(value);}
  }return issues;
}
export class ProductImportService {
  constructor(readonly auth:AuthService){}
  authorize(ctx:AuthContext,businessId:string){return this.auth.transaction(tx=>access(this.auth,tx,ctx,businessId));}
  async discard(ctx:AuthContext,businessId:string,id:string){
    await this.auth.transaction(async tx=>{await access(this.auth,tx,ctx,businessId);await tx.productImport.updateMany({where:{id,businessId,actorId:ctx.user.id,status:'PREVIEW'},data:{status:'EXPIRED',payload:''}});});
    return {ok:true};
  }
  async preview(ctx:AuthContext,businessId:string,base64:string){
    await this.authorize(ctx,businessId);
    const source=await parseWorkbook(Buffer.from(base64,'base64'));
    if(!source[0] || source[0].invalid || columns.some((column,i)=>source[0]!.values[i]!==column))throw new ApiError(422,'IMPORT_HEADERS','Use the provided template headers');
    const rows:Parsed[]=[],issues:Issue[]=[];
    for(const item of source.slice(1)){
      if(item.invalid){issues.push({row:item.row,field:'row',code:'PLAIN_VALUES_REQUIRED'});continue;}
      const record=Object.fromEntries(columns.map((column,i)=>[column,item.values[i]??'']));
      if(typeof record.sku!=='string'||typeof record.barcodes!=='string'){issues.push({row:item.row,field:'sku/barcodes',code:'TEXT_REQUIRED'});continue;}
      for(const field of ['purchasePrice','sellingPrice','minimumStock'])record[field]=String(record[field]);
      const parsed=productSchema.safeParse({...record,minimumStock:record.minimumStock||'0',active:record.active===''?true:record.active==='true'?true:record.active==='false'?false:record.active,barcodes:String(record.barcodes).split(/\r?\n/).map(v=>v.trim()).filter(Boolean)});
      if(!parsed.success){for(const issue of parsed.error.issues)issues.push({row:item.row,field:String(issue.path[0]??'row'),code:'INVALID_VALUE'});}
      else rows.push({row:item.row,product:parsed.data});
    }
    if(source.length<2)throw new ApiError(422,'IMPORT_EMPTY','The workbook has no product rows');
    return this.auth.transaction(async tx=>{
      const {business}=await access(this.auth,tx,ctx,businessId);
      if(!(await billingState(tx,businessId)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','An active subscription is required');
      const allIssues=[...issues,...await conflicts(tx,businessId,rows)];
      const definitions=await tx.catalogueReference.findMany({where:{businessId}});
      const units=new Set([...baseUnits,...definitions.filter(r=>r.kind==='UNIT'&&r.active).map(r=>r.code)]);
      const retiredCategories=new Set(definitions.filter(r=>r.kind==='CATEGORY'&&!r.active).map(r=>r.name));
      for(const row of rows){
        if(!units.has(row.product.unit))allIssues.push({row:row.row,field:'unit',code:'INVALID_VALUE'});
        if(retiredCategories.has(row.product.category))allIssues.push({row:row.row,field:'category',code:'INVALID_VALUE'});
      }
      if(allIssues.length)return {id:null,currency:business.baseCurrency,total:source.length-1,issues:allIssues,rows};
      await tx.productImport.updateMany({where:{businessId,actorId:ctx.user.id,status:'PREVIEW',expiresAt:{lte:new Date()}},data:{payload:'',status:'EXPIRED'}});
      if(await tx.productImport.count({where:{businessId,actorId:ctx.user.id,status:'PREVIEW'}})>=5)throw new ApiError(429,'IMPORT_PREVIEW_LIMIT','Finish an existing preview or wait for it to expire');
      const id=randomUUID(),expiresAt=new Date(Date.now()+30*60000);
      await tx.productImport.create({data:{id,businessId,actorId:ctx.user.id,currency:business.baseCurrency,rowCount:rows.length,expiresAt,payload:encrypt(this.auth.settings.key,JSON.stringify(rows),`product-import:${id}`)}});
      return {id,currency:business.baseCurrency,total:rows.length,issues,rows,expiresAt};
    });
  }
  async commit(ctx:AuthContext,businessId:string,id:string){
    try{return await this.auth.transaction(async tx=>{
      const {business}=await access(this.auth,tx,ctx,businessId);
      await tx.$queryRaw`SELECT id FROM product_imports WHERE id=${id}::uuid AND business_id=${businessId}::uuid AND actor_id=${ctx.user.id}::uuid FOR UPDATE`;
      const batch=await tx.productImport.findFirst({where:{id,businessId,actorId:ctx.user.id}});
      if(!batch)throw new ApiError(404,'NOT_FOUND','Import not found');
      if(batch.status==='COMPLETED')return {id,count:batch.rowCount,completedAt:batch.completedAt};
      if(batch.status!=='PREVIEW'||batch.expiresAt<=new Date())throw new ApiError(409,'IMPORT_EXPIRED','Upload the workbook again');
      if(batch.currency!==business.baseCurrency)throw new ApiError(409,'IMPORT_CURRENCY_CHANGED','Business currency changed; preview again');
      if(!(await billingState(tx,businessId)).active)throw new ApiError(402,'SUBSCRIPTION_REQUIRED','An active subscription is required');
      const rows=z.array(z.object({row:z.number().int(),product:productSchema})).min(1).max(500).parse(JSON.parse(decrypt(this.auth.settings.key,batch.payload,`product-import:${id}`)));
      if((await conflicts(tx,businessId,rows)).length)throw new ApiError(409,'IMPORT_CONFLICT','Catalogue changed; preview the workbook again');
      const products=rows.map(({product:{barcodes,...product}})=>({id:randomUUID(),businessId,...product,barcodes}));
      for(const product of products)await validateReferences(tx,businessId,product);
      await tx.product.createMany({data:products.map(({barcodes,...product})=>product)});
      await tx.productBarcode.createMany({data:products.flatMap(p=>p.barcodes.map(value=>({businessId,productId:p.id,value})))});
      await tx.authAudit.createMany({data:products.map(p=>({userId:ctx.user.id,businessId,action:'product.created',targetId:p.id,changes:{sku:p.sku,importId:id}}))});
      if(!business.currencyLockedAt)await tx.business.update({where:{id:businessId},data:{currencyLockedAt:new Date(),revision:{increment:1}}});
      const completedAt=new Date();await tx.productImport.update({where:{id},data:{status:'COMPLETED',completedAt,payload:''}});
      await tx.authAudit.create({data:{userId:ctx.user.id,businessId,action:'products.imported',targetId:id,changes:{count:products.length}}});
      return {id,count:products.length,completedAt};
    });}catch(error){if((error as {code?:string}).code==='P2002')throw new ApiError(409,'IMPORT_CONFLICT','Catalogue changed; preview again');throw error;}
  }
}
