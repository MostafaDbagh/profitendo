import { Router,json,type Request } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { ApiError,validateBody } from '../errors.js';
import { ImageService } from './images.js';
export function imageRouter(auth:AuthService){
 const router=Router({mergeParams:true}),service=new ImageService(auth),{ctx,origin,attach,full,csrf}=authHttp(auth);
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.use(origin,attach,full);
 router.use((req,_res,next)=>{if(!z.string().uuid().safeParse(req.params.businessId).success||!z.string().uuid().safeParse(req.params.productId).success)throw new ApiError(400,'INVALID_ID','Invalid identifier');next();});
 const ids=(req:Request)=>[String(req.params.businessId),String(req.params.productId)] as const;
 router.get('/',async(req,res)=>res.json(await service.get(ctx(res),...ids(req))));
 router.put('/',csrf,async(_req,res,next)=>{await auth.limit('product-image',ctx(res).user.id,60,3600);next();},json({limit:'1400kb'}),validateBody(z.object({revision:z.number().int().nonnegative(),fileBase64:z.string().max(1398104).nullable()}).strict()),async(req,res)=>res.json(await service.save(ctx(res),...ids(req),req.body.revision,req.body.fileBase64)));
 return router;
}
