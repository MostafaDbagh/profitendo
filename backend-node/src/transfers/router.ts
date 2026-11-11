import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { ApiError, validateBody } from '../errors.js';
import { transferSchema, transferPatch, transferAction, transferEvent } from './contracts.js';
import { TransferService } from './service.js';
export function transferRouter(auth:AuthService){
 const router=Router({mergeParams:true}),service=new TransferService(auth),{ctx,origin,attach,full,csrf}=authHttp(auth);
 const bid=(req:Request)=>String(req.params.businessId),id=(req:Request)=>String(req.params.id);
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.use(origin,attach,full);
 router.use((req,res,next)=>req.method==='GET'?next():csrf(req,res,next));
 router.use((req,_res,next)=>{if(!z.uuid().safeParse(bid(req)).success)throw new ApiError(400,'INVALID_ID','Invalid business');next();});
 router.param('id',(_req,_res,next,value)=>{if(!z.uuid().safeParse(value).success)throw new ApiError(400,'INVALID_ID','Invalid transfer');next();});
 const page=z.coerce.number().int().min(1).max(10000).default(1);
 router.get('/',async(req,res)=>{
  const q=z.object({page,status:z.enum(['DRAFT','IN_TRANSIT','PARTIAL','COMPLETED','CANCELLED']).optional(),locationId:z.uuid().optional(),search:z.string().trim().max(100).default('')}).strict().safeParse(req.query);
  if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid filters');
  res.json(await service.list(ctx(res),bid(req),q.data));
 });
 router.get('/:id/events',async(req,res)=>{
  const q=z.object({page}).strict().safeParse(req.query);if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid page');
  res.json(await service.events(ctx(res),bid(req),id(req),q.data.page));
 });
 router.get('/:id',async(req,res)=>{res.json(await service.read(ctx(res),bid(req),id(req)));});
 router.post('/',validateBody(transferSchema),async(req,res)=>{res.status(201).json(await service.create(ctx(res),bid(req),req.body));});
 router.patch('/:id',validateBody(transferPatch),async(req,res)=>{res.json(await service.update(ctx(res),bid(req),id(req),req.body));});
 router.post('/:id/status',validateBody(transferAction),async(req,res)=>{res.json(await service.transition(ctx(res),bid(req),id(req),req.body));});
 router.post('/:id/events',validateBody(transferEvent),async(req,res)=>{res.json(await service.record(ctx(res),bid(req),id(req),req.body));});
 return router;
}
