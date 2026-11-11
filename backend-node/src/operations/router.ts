import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { authHttp } from '../auth/http.js';
import { ApiError, validateBody } from '../errors.js';
import { documentSchema, documentPatch, supplierSchema, supplierPatch, transitionSchema } from './contracts.js';
import { SupplierService } from './suppliers.js';
import { InventoryService } from './inventory.js';
import { PurchasingService } from './purchasing.js';
export function operationsRouter(auth:AuthService){
 const router=Router({mergeParams:true}),{ctx,origin,attach,full,csrf}=authHttp(auth);
 const suppliers=new SupplierService(auth),inventory=new InventoryService(auth),purchasing=new PurchasingService(auth);
 const bid=(req:Request)=>String(req.params.businessId),id=(req:Request)=>String(req.params.id);
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.use(origin,attach,full);
 router.use((req,res,next)=>req.method==='GET'?next():csrf(req,res,next));
 router.use((req,_res,next)=>{if(!z.uuid().safeParse(bid(req)).success)throw new ApiError(400,'INVALID_ID','Invalid business');next();});
 router.param('id',(_req,_res,next,value)=>{if(!z.uuid().safeParse(value).success)throw new ApiError(400,'INVALID_ID','Invalid identifier');next();});
 const page=z.coerce.number().int().min(1).max(10000).default(1),search=z.string().trim().max(160).default('');
 router.get('/suppliers',async(req,res)=>{
  const q=z.object({page,search,state:z.enum(['active','inactive','all']).default('active')}).strict().safeParse(req.query);
  if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid filters');
  res.json(await suppliers.list(ctx(res),bid(req),q.data.page,q.data.search,q.data.state));
 });
 router.post('/suppliers',validateBody(supplierSchema),async(req,res)=>{res.status(201).json(await suppliers.save(ctx(res),bid(req),req.body));});
 router.patch('/suppliers/:id',validateBody(supplierPatch),async(req,res)=>{res.json(await suppliers.save(ctx(res),bid(req),req.body,id(req)));});
 router.get('/inventory',async(req,res)=>{
  const q=z.object({page,search,locationId:z.uuid(),view:z.enum(['balances','movements']).default('balances')}).strict().safeParse(req.query);
  if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Choose a location');
  res.json(await inventory.list(ctx(res),bid(req),q.data.locationId,q.data.page,q.data.search,q.data.view==='movements'));
 });
 router.get('/purchases',async(req,res)=>{
  const q=z.object({page,kind:z.enum(['ORDER','RECEIPT']).default('RECEIPT'),locationId:z.uuid().optional(),supplierId:z.uuid().optional(),status:z.enum(['DRAFT','PENDING','OPEN','PARTIAL','RECEIVED','COMPLETED','CANCELLED']).optional()}).strict().safeParse(req.query);
  if(!q.success)throw new ApiError(422,'VALIDATION_ERROR','Invalid filters');
  res.json(await purchasing.list(ctx(res),bid(req),q.data));
 });
 router.get('/purchases/:id',async(req,res)=>{res.json(await purchasing.read(ctx(res),bid(req),id(req)));});
 router.post('/purchases',validateBody(documentSchema),async(req,res)=>{res.status(201).json(await purchasing.create(ctx(res),bid(req),req.body));});
 router.patch('/purchases/:id',validateBody(documentPatch),async(req,res)=>{res.json(await purchasing.update(ctx(res),bid(req),id(req),req.body));});
 router.post('/purchases/:id/status',validateBody(transitionSchema),async(req,res)=>{res.json(await purchasing.transition(ctx(res),bid(req),id(req),req.body));});
 return router;
}
