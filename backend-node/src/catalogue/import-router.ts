import { Router, json, type Request } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { ApiError, validateBody } from '../errors.js';
import { ProductImportService } from './import-service.js';
import { importTemplate } from './workbook.js';
export function productImportRouter(auth:AuthService){
  const router=Router({mergeParams:true}),service=new ProductImportService(auth),{ctx,origin,attach,full,csrf}=authHttp(auth);
  const bid=(req:Request)=>String(req.params.businessId);
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  router.use(origin,attach,full);router.use((req,res,next)=>req.method==='GET'?next():csrf(req,res,next));
  router.use(async(req,res,next)=>{if(!z.string().uuid().safeParse(bid(req)).success)throw new ApiError(400,'INVALID_ID','Invalid business');await service.authorize(ctx(res),bid(req));next();});
  router.use(json({limit:'1400kb'}));
  router.param('importId',(_req,_res,next,id)=>{if(!z.string().uuid().safeParse(id).success)throw new ApiError(400,'INVALID_ID','Invalid import');next();});
  router.get('/template',async(_req,res)=>{res.json({filename:'product-import-template.xlsx',fileBase64:await importTemplate()});});
  router.post('/preview',validateBody(z.object({filename:z.string().max(200).regex(/\.xlsx$/i),fileBase64:z.string().max(1400000).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict()),async(req,res)=>{
    await auth.limit('product-import',ctx(res).user.id,20,3600);
    res.status(201).json(await service.preview(ctx(res),bid(req),req.body.fileBase64));
  });
  router.post('/:importId/commit',validateBody(z.object({confirm:z.literal(true)}).strict()),async(req,res)=>{res.json(await service.commit(ctx(res),bid(req),String(req.params.importId)));});
  router.post('/:importId/discard',validateBody(z.object({}).strict()),async(req,res)=>{
    res.json(await service.discard(ctx(res),bid(req),String(req.params.importId)));
  });
  return router;
}
