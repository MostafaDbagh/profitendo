import { Router } from 'express';
import { z } from 'zod';
import type { AuthService,AuthContext,Tx } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { digest,randomToken,equal } from '../auth/crypto.js';
import { requirePlatform } from '../platform/service.js';
import { ApiError,validateBody } from '../errors.js';
const body=z.string().trim().min(2).max(5000),category=z.enum(['SUBSCRIPTION','BILLING','TECHNICAL','GENERAL']);
const newTicket=z.object({subject:z.string().trim().min(3).max(160),category,body,businessId:z.uuid().optional()}).strict();
const publicTicket=newTicket.omit({businessId:true}).extend({name:z.string().trim().min(2).max(100),email:z.email().max(254),website:z.string().max(0).optional()}).strict();
const invalid=()=>new ApiError(404,'NOT_FOUND','Request not found');
export function supportRouter(auth:AuthService){
 const router=Router(),{origin,attach,full,csrf,ctx}=authHttp(auth);
 router.use(origin,(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.param('id',(_q,_s,next,id)=>{if(!z.uuid().safeParse(id).success)return next(invalid());next();});
 async function thread(tx:Tx,id:string){const row=await tx.supportTicket.findUnique({where:{id},include:{business:{select:{name:true}},messages:{orderBy:[{createdAt:'asc'},{id:'asc'}],take:200}}});if(!row)throw invalid();const {guestTokenHash,...safe}=row;return safe;}
 async function authorize(tx:Tx,id:string,current?:AuthContext,token?:string,admin=false){
  const row=await tx.supportTicket.findUnique({where:{id}});if(!row)throw invalid();
  if(admin){await requirePlatform(auth,tx,current!);return row;}
  if(current){await auth.assertSession(tx,current);if(row.userId!==current.user.id)throw invalid();}
  else if(!token||token.length!==43||!row.guestTokenHash||!equal(digest(token),row.guestTokenHash))throw invalid();
  return row;
 }
 router.post('/public',validateBody(publicTicket),async(req,res)=>{
  await auth.limit('contact-ip',req.ip??'',5,3600);await auth.limit('contact-email',req.body.email.toLowerCase(),3,3600);const token=randomToken();
  const row=await auth.db.supportTicket.create({data:{name:req.body.name,email:req.body.email.toLowerCase(),subject:req.body.subject,category:req.body.category,guestTokenHash:digest(token),messages:{create:{body:req.body.body}}}});
  res.status(201).json({id:row.id,token});
 });
 router.get('/public/:id',async(req,res)=>{await auth.limit('contact-read',req.ip??'',120,60);res.json(await auth.transaction(async tx=>{await authorize(tx,String(req.params.id),undefined,req.get('X-Support-Token'));return thread(tx,String(req.params.id));}));});
 router.post('/public/:id/messages',validateBody(z.object({body}).strict()),async(req,res)=>{
  await auth.limit('contact-reply',req.ip??'',20,3600);
  res.json(await auth.transaction(async tx=>{const row=await authorize(tx,String(req.params.id),undefined,req.get('X-Support-Token'));await reply(tx,row.id,req.body.body,false);return {ok:true};}));
 });
 router.use(attach,full);router.use((req,res,next)=>req.method==='GET'?next():csrf(req,res,next));
 async function reply(tx:Tx,id:string,text:string,admin:boolean,authorId?:string){
  if(await tx.supportMessage.count({where:{ticketId:id}})>=200)throw new ApiError(409,'THREAD_FULL','Start a new request');
  await tx.supportMessage.create({data:{ticketId:id,body:text,fromAdmin:admin,authorId}});
  await tx.supportTicket.update({where:{id},data:{status:admin?'IN_PROGRESS':'NEW',revision:{increment:1}}});
 }
 router.post('/tickets',validateBody(newTicket),async(req,res)=>{
  await auth.limit('support-create',ctx(res).user.id,10,3600);
  res.status(201).json(await auth.transaction(async tx=>{
   const {user}=await auth.assertSession(tx,ctx(res));if(req.body.businessId){const m=await tx.membership.findUnique({where:{businessId_userId:{businessId:req.body.businessId,userId:user.id}}});if(!m||m.disabledAt)throw new ApiError(403,'FORBIDDEN','Business membership required');}
   const row=await tx.supportTicket.create({data:{name:user.name,email:user.email,userId:user.id,businessId:req.body.businessId,subject:req.body.subject,category:req.body.category,messages:{create:{body:req.body.body,authorId:user.id}}}});return {id:row.id};
  }));
 });
 for(const admin of [false,true]){
  const prefix=admin?'/admin/tickets':'/tickets';
  router.get(prefix,async(req,res)=>{
   const q=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),status:z.enum(['ALL','NEW','IN_PROGRESS','RESOLVED']).default('ALL')}).strict().safeParse(req.query);if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid query');
   res.json(await auth.transaction(async tx=>{if(admin)await requirePlatform(auth,tx,ctx(res));else await auth.assertSession(tx,ctx(res));const where={...(!admin?{userId:ctx(res).user.id}:{}),...(q.data.status==='ALL'?{}:{status:q.data.status})};return {page:q.data.page,pageSize:25,total:await tx.supportTicket.count({where}),items:await tx.supportTicket.findMany({where,take:25,skip:(q.data.page-1)*25,orderBy:[{updatedAt:'desc'},{id:'desc'}],select:{business:{select:{name:true}},id:true,name:true,email:true,businessId:true,subject:true,category:true,status:true,revision:true,updatedAt:true}})};}));
  });
  router.get(prefix+'/:id',async(req,res)=>res.json(await auth.transaction(async tx=>{await authorize(tx,String(req.params.id),ctx(res),undefined,admin);return thread(tx,String(req.params.id));})));
  router.post(prefix+'/:id/messages',validateBody(z.object({body}).strict()),async(req,res)=>{await auth.limit('support-reply',ctx(res).user.id,60,3600);res.json(await auth.transaction(async tx=>{await authorize(tx,String(req.params.id),ctx(res),undefined,admin);await reply(tx,String(req.params.id),req.body.body,admin,ctx(res).user.id);if(admin)await tx.authAudit.create({data:{action:'support.replied',userId:ctx(res).user.id,targetId:String(req.params.id)}});return {ok:true};}));});
 }
 router.patch('/admin/tickets/:id',validateBody(z.object({revision:z.number().int().nonnegative(),status:z.enum(['NEW','IN_PROGRESS','RESOLVED'])}).strict()),async(req,res)=>res.json(await auth.transaction(async tx=>{
  await requirePlatform(auth,tx,ctx(res));const r=await tx.supportTicket.updateMany({where:{id:String(req.params.id),revision:req.body.revision},data:{status:req.body.status,revision:{increment:1}}});if(!r.count)throw new ApiError(409,'REVISION_CONFLICT','Request changed; reload');await tx.authAudit.create({data:{action:'support.'+req.body.status.toLowerCase(),userId:ctx(res).user.id,targetId:String(req.params.id)}});return {ok:true};
 })));
 return router;
}
