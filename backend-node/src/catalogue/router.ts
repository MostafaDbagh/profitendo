import { ReferenceService, referenceSchema } from './references.js';
import { PackService, packSchema, conversionSchema } from './packs.js';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { ApiError, validateBody } from '../errors.js';
import { CatalogueService } from './service.js';
import { barcode, productSchema, patchSchema } from './contracts.js';
export function catalogueRouter(auth:AuthService){
  const router=Router({mergeParams:true}),service=new CatalogueService(auth),{ctx,origin,attach,full,csrf}=authHttp(auth);
  const bid=(req:Request)=>String(req.params.businessId);
  const uuid=(value:unknown)=>{const id=z.string().uuid().safeParse(value);if(!id.success)throw new ApiError(400,'INVALID_ID','Invalid identifier');return id.data;};
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});router.use(origin,attach,full);
  router.use((req,res,next)=>req.method==='GET'?next():csrf(req,res,next));
  router.use((req,_res,next)=>{if(!z.string().uuid().safeParse(bid(req)).success)throw new ApiError(400,'INVALID_ID','Invalid business identifier');next();});
  router.param('productId',(_req,_res,next,id)=>{if(!z.string().uuid().safeParse(id).success)throw new ApiError(400,'INVALID_ID','Invalid product identifier');next();});
  router.get('/',async(req,res)=>{
    const q=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),search:z.string().trim().max(160).optional(),state:z.enum(['active','inactive','all']).default('active')}).strict().safeParse(req.query);
    if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid catalogue filters');res.json(await service.list(ctx(res),bid(req),q.data));
  });
  router.get('/barcode',async(req,res)=>{
    const q=z.object({value:barcode}).strict().safeParse(req.query);if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid barcode');
    res.json(await service.get(ctx(res),bid(req),{barcode:q.data.value}));
  });
  const references=new ReferenceService(auth);
  router.get('/references',async(req,res)=>res.json(await references.list(ctx(res),bid(req))));
  router.post('/references',validateBody(referenceSchema),async(req,res)=>res.status(201).json(await references.create(ctx(res),bid(req),req.body)));
  router.patch('/references/:referenceId',validateBody(z.object({revision:z.number().int().nonnegative(),active:z.boolean()}).strict()),async(req,res)=>{
    const id=uuid(req.params.referenceId);res.json(await references.state(ctx(res),bid(req),id,req.body.revision,req.body.active));
  });
  const packs=new PackService(auth);
  router.post('/:productId/packs/:packId/retire',validateBody(z.object({confirm:z.literal(true)}).strict()),async(req,res)=>res.json(await packs.retire(ctx(res),bid(req),String(req.params.productId),uuid(req.params.packId))));
  router.get('/:productId/packs',async(req,res)=>{res.json(await packs.list(ctx(res),bid(req),String(req.params.productId)));});
  router.post('/:productId/packs',validateBody(packSchema),async(req,res)=>{res.status(201).json(await packs.create(ctx(res),bid(req),String(req.params.productId),req.body));});
  router.post('/:productId/packs/:packId/convert',validateBody(conversionSchema),async(req,res)=>{
    const id=z.string().uuid().safeParse(req.params.packId);
    if(!id.success)throw new ApiError(400,'INVALID_ID','Invalid pack identifier');
    res.json(await packs.convert(ctx(res),bid(req),String(req.params.productId),id.data,req.body.quantity));
  });
  router.get('/:productId',async(req,res)=>{res.json(await service.get(ctx(res),bid(req),{id:String(req.params.productId)}));});
  router.post('/',validateBody(productSchema),async(req,res)=>{res.status(201).json(await service.create(ctx(res),bid(req),req.body));});
  router.patch('/:productId',validateBody(patchSchema),async(req,res)=>{res.json(await service.update(ctx(res),bid(req),String(req.params.productId),req.body));});
  return router;
}
