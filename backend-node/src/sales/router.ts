import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { ApiError, validateBody } from '../errors.js';
import { saleSchema,salePatch,cancelSchema,checkoutSchema } from './contracts.js';
import { SalesService } from './service.js';
export function salesRouter(auth:AuthService){
 const router=Router({mergeParams:true}),service=new SalesService(auth),{ctx,origin,attach,full,csrf}=authHttp(auth);
 const bid=(req:Request)=>String(req.params.businessId),id=(req:Request)=>String(req.params.id);
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});router.use(origin,attach,full);router.use((req,res,next)=>req.method==='GET'?next():csrf(req,res,next));
 router.use((req,_res,next)=>{if(!z.uuid().safeParse(bid(req)).success)throw new ApiError(400,'INVALID_ID','Invalid business');next();});
 router.param('id',(_req,_res,next,value)=>{if(!z.uuid().safeParse(value).success)throw new ApiError(400,'INVALID_ID','Invalid sale');next();});
 const page=z.coerce.number().int().min(1).max(10000).default(1);
 router.get('/products',async(req,res)=>{const q=z.object({locationId:z.uuid(),page,search:z.string().trim().max(100).default(''),barcode:z.string().min(1).max(100).optional()}).strict().safeParse(req.query);if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid search');res.json(await service.products(ctx(res),bid(req),q.data));});
 router.get('/',async(req,res)=>{const q=z.object({page,locationId:z.uuid().optional(),status:z.enum(['DRAFT','COMPLETED','CANCELLED']).optional()}).strict().safeParse(req.query);if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid filters');res.json(await service.list(ctx(res),bid(req),q.data));});
 router.get('/:id',async(req,res)=>res.json(await service.read(ctx(res),bid(req),id(req))));
 router.post('/',validateBody(saleSchema),async(req,res)=>res.status(201).json(await service.create(ctx(res),bid(req),req.body)));
 router.patch('/:id',validateBody(salePatch),async(req,res)=>res.json(await service.update(ctx(res),bid(req),id(req),req.body)));
 router.post('/:id/cancel',validateBody(cancelSchema),async(req,res)=>res.json(await service.cancel(ctx(res),bid(req),id(req),req.body.revision)));
 router.post('/:id/checkout',validateBody(checkoutSchema),async(req,res)=>res.json(await service.checkout(ctx(res),bid(req),id(req),req.body)));
 return router;
}
