import {emailConfigured} from '../auth/mail-settings.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {AuthService,AuthContext,Tx} from '../auth/service.js';
import type {CashClose} from '../generated/prisma/client.js';
import {requireBusiness} from '../businesses/access.js';
import {decrypt} from '../auth/crypto.js';
import {hash,fail,entitled} from '../workflows/shared.js';
import {businessDay} from '../finance/cash.js';
import {allowedReportTypes,reportRecipient,reportTypes} from './delivery-access.js';
export const preferenceSchema=z.object({revision:z.number().int().min(0),enabled:z.boolean(),reportTypes:z.array(z.enum(reportTypes)).min(1).max(6).refine(v=>new Set(v).size===v.length),language:z.enum(['en','ar'])}).strict();
export const sendReportSchema=z.object({clientKey:z.uuid(),from:z.iso.date(),to:z.iso.date(),locationId:z.uuid().optional()}).strict();
export async function queueClosingReports(tx:Tx,close:CashClose){
 const preferences=await tx.reportPreference.findMany({where:{businessId:close.businessId,enabled:true}});
 const data=[];
 for(const p of preferences){if(!await reportRecipient(tx,close.businessId,p.userId,p.reportTypes,close.locationId))continue;
  data.push({businessId:close.businessId,userId:p.userId,requestKey:`close:${close.id}`,requestHash:hash({closeId:close.id}),automatic:true,closeId:close.id,locationId:close.locationId,fromDay:close.day,toDay:close.day,reportTypes:p.reportTypes,language:p.language,createdAt:close.createdAt});
 }
 if(data.length)await tx.reportDelivery.createMany({data,skipDuplicates:true});
}
export class ReportDeliveryService{
 constructor(readonly auth:AuthService){}
 async settings(ctx:AuthContext,bid:string){return this.auth.transaction(async tx=>{
  const a=await requireBusiness(this.auth,tx,ctx,bid,'reports.deliver');if(!a.permissions['reports.view']||!a.permissions['locations.view'])fail('FORBIDDEN',403);
  const row=await tx.reportPreference.findUnique({where:{businessId_userId:{businessId:bid,userId:ctx.user.id}}}),allowed=allowedReportTypes(a.permissions);
  return {emailDeliveryConfigured:emailConfigured(process.env),enabled:row?.enabled??false,revision:row?.revision??0,reportTypes:(row?.reportTypes??allowed).filter(t=>allowed.includes(t as typeof allowed[number])),language:row?.language??'en',allowedTypes:allowed,email:a.user.email};
 });}
 async save(ctx:AuthContext,bid:string,input:z.infer<typeof preferenceSchema>){try{return await this.auth.transaction(async tx=>{
  const a=await requireBusiness(this.auth,tx,ctx,bid,'reports.deliver');if(!a.permissions['reports.view']||!a.permissions['locations.view'])fail('FORBIDDEN',403);
  await tx.$queryRaw`SELECT id FROM businesses WHERE id=${bid}::uuid FOR UPDATE`;
  if(input.enabled){await entitled(tx,bid);if(!a.user.emailVerifiedAt||input.reportTypes.some(t=>!allowedReportTypes(a.permissions).includes(t)))fail('FORBIDDEN',403);}
  const prior=await tx.reportPreference.findUnique({where:{businessId_userId:{businessId:bid,userId:ctx.user.id}}});if((prior?.revision??0)!==input.revision)fail('REVISION_CONFLICT');
  const data={enabled:input.enabled,reportTypes:input.reportTypes,language:input.language,revision:input.revision+1};
  await tx.reportPreference.upsert({where:{businessId_userId:{businessId:bid,userId:ctx.user.id}},create:{businessId:bid,userId:ctx.user.id,...data},update:data});
  if(!input.enabled)await tx.reportDelivery.updateMany({where:{businessId:bid,userId:ctx.user.id,automatic:true,OR:[{mail:{is:null}},{mail:{is:{deliveredAt:null}}}]},data:{cancelledAt:new Date()}});
  await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'reports.preferences_updated',changes:{enabled:input.enabled,reportTypes:input.reportTypes}}});return {ok:true,revision:data.revision};
 });}catch(error){if((error as {code?:string}).code==='P2002')fail('REVISION_CONFLICT');throw error;}}
 async send(ctx:AuthContext,bid:string,input:z.infer<typeof sendReportSchema>,retry=true):Promise<{id:string}>{try{return await this.auth.transaction(async tx=>{
  const a=await requireBusiness(this.auth,tx,ctx,bid,'reports.deliver');
  await tx.$queryRaw`SELECT id FROM businesses WHERE id=${bid}::uuid FOR UPDATE`;
  const requestHash=hash(input),prior=await tx.reportDelivery.findUnique({where:{businessId_userId_requestKey:{businessId:bid,userId:ctx.user.id,requestKey:input.clientKey}}});if(prior){if(prior.requestHash!==requestHash)fail('IDEMPOTENCY_CONFLICT');return {id:prior.id};}
  const pref=await tx.reportPreference.findUnique({where:{businessId_userId:{businessId:bid,userId:ctx.user.id}}});if(!pref)fail('REPORT_SETTINGS_REQUIRED',422);
  if(!await reportRecipient(tx,bid,ctx.user.id,pref.reportTypes,input.locationId??null))fail('FORBIDDEN',403);
  const days=(Date.parse(input.to)-Date.parse(input.from))/86400000+1;if(days<1||days>366||input.to>businessDay(new Date(),a.business.timezone))fail('REPORT_RANGE',422);await entitled(tx,bid);
  const row=await tx.reportDelivery.create({data:{id:randomUUID(),businessId:bid,userId:ctx.user.id,requestKey:input.clientKey,requestHash,locationId:input.locationId??null,fromDay:input.from,toDay:input.to,reportTypes:pref.reportTypes,language:pref.language}});
  await tx.authAudit.create({data:{businessId:bid,userId:ctx.user.id,action:'reports.manual_requested',targetId:row.id}});return {id:row.id};
 });}catch(error){if(retry&&(error as {code?:string}).code==='P2002')return this.send(ctx,bid,input,false);throw error;}}
 async list(ctx:AuthContext,bid:string){return this.auth.transaction(async tx=>{
  await requireBusiness(this.auth,tx,ctx,bid,'reports.deliver');
  const rows=await tx.reportDelivery.findMany({where:{businessId:bid,userId:ctx.user.id},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50,include:{mail:{select:{deliveredAt:true,attempts:true}}}});
  const items=[];for(const row of rows){if(!await reportRecipient(tx,bid,ctx.user.id,row.reportTypes,row.locationId))continue;items.push({id:row.id,from:row.fromDay,to:row.toDay,automatic:row.automatic,createdAt:row.createdAt,reportTypes:row.reportTypes,ready:!!row.snapshot,status:row.cancelledAt?'CANCELLED':row.mail?.deliveredAt?'SENT':(row.mail?.attempts??row.attempts)>=8?'FAILED':row.snapshot?'EMAIL_QUEUED':'PREPARING'});}return {items};
 });}
 async read(ctx:AuthContext,bid:string,id:string){return this.auth.transaction(async tx=>{
  await requireBusiness(this.auth,tx,ctx,bid,'reports.deliver');const row=await tx.reportDelivery.findFirst({where:{id,businessId:bid,userId:ctx.user.id}});
  if(!row||!await reportRecipient(tx,bid,ctx.user.id,row.reportTypes,row.locationId))fail('NOT_FOUND',404);
  if(!row.snapshot)fail('REPORT_NOT_READY',409);return JSON.parse(decrypt(this.auth.settings.key,row.snapshot,`report:${id}`));
 });}
}
