import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { ApiError, validateBody } from '../errors.js';
import { LocationService } from './service.js';
const businessId=(req:Request)=>String(req.params.businessId);
const name=z.string().trim().min(2).max(120),address=z.string().trim().max(500);
export function locationRouter(auth:AuthService){
  const router=Router({mergeParams:true}),service=new LocationService(auth),{ctx,origin,attach,full,csrf}=authHttp(auth);
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});router.use(origin,attach,full);
  router.use((req,res,next)=>req.method==='GET'?next():csrf(req,res,next));
  router.use((req,_res,next)=>{if(!z.string().uuid().safeParse(req.params.businessId).success)return next(new ApiError(400,'INVALID_ID','Invalid business identifier'));next();});
  router.param('locationId',(_req,_res,next,id)=>{if(!z.string().uuid().safeParse(id).success)return next(new ApiError(400,'INVALID_ID','Invalid location identifier'));next();});
  router.get('/',async(req,res)=>{
    const parsed=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),state:z.enum(['active','archived','all']).default('active'),kind:z.enum(['WAREHOUSE','SHOP']).optional(),search:z.string().trim().max(120).optional()}).strict().safeParse(req.query);
    if(!parsed.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid location filters');res.json(await service.list(ctx(res),businessId(req),parsed.data));
  });
  router.post('/',validateBody(z.object({code:z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/),name,kind:z.enum(['WAREHOUSE','SHOP']),address:address.default('')}).strict()),async(req,res)=>{res.status(201).json(await service.create(ctx(res),businessId(req),req.body));});
  router.patch('/:locationId',validateBody(z.object({revision:z.number().int().nonnegative(),name:name.optional(),address:address.optional(),active:z.boolean().optional()}).strict().refine(v=>v.name!==undefined||v.address!==undefined||v.active!==undefined)),async(req,res)=>{res.json(await service.update(ctx(res),businessId(req),String(req.params.locationId),req.body));});
  router.get('/:locationId/assignments',async(req,res)=>{
    const parsed=z.object({page:z.coerce.number().int().min(1).max(10000).default(1)}).strict().safeParse(req.query);if(!parsed.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid pagination');
    res.json(await service.assignments(ctx(res),businessId(req),String(req.params.locationId),parsed.data.page));
  });
  router.put('/:locationId/assignments',validateBody(z.object({revision:z.number().int().nonnegative(),membershipId:z.string().uuid(),assigned:z.boolean()}).strict()),async(req,res)=>{res.json(await service.assign(ctx(res),businessId(req),String(req.params.locationId),req.body));});
  return router;
}
