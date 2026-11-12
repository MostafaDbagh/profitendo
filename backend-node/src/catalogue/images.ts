import sharp from 'sharp';
import type { AuthContext, AuthService } from '../auth/service.js';
import { requireBusiness } from '../businesses/access.js';
import { ApiError } from '../errors.js';
let decoding=0;
export class ImageService {
 constructor(readonly auth:AuthService){}
 async get(ctx:AuthContext,businessId:string,productId:string){return this.auth.transaction(async tx=>{
  await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.view');
  if(!await tx.product.findFirst({where:{id:productId,businessId}}))throw new ApiError(404,'PRODUCT_NOT_FOUND','Product not found');
  const row=await tx.productImage.findFirst({where:{businessId,productId}});return {dataUrl:row?`data:image/webp;base64,${row.data}`:null};
 });}
 async save(ctx:AuthContext,businessId:string,productId:string,revision:number,file:string|null){
  await this.auth.transaction(tx=>requireBusiness(this.auth,tx,ctx,businessId,'catalogue.manage'));
  let data:string|null=null;
  if(file!==null){
   if(decoding>=2)throw new ApiError(429,'IMAGE_BUSY','Try again shortly');
   decoding++;
   try{
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(file))throw new Error();
    const bytes=Buffer.from(file,'base64');if(bytes.length>1024*1024)throw new Error();
    const image=sharp(bytes,{limitInputPixels:12000000,failOn:'warning'}).timeout({seconds:5});
    const meta=await image.metadata();if(!['jpeg','png','webp'].includes(meta.format)|| (meta.pages??1)>1)throw new Error();
    const output=await image.rotate().resize(800,800,{fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer();
    if(output.length>250000)throw new Error();data=output.toString('base64');
   }catch{throw new ApiError(422,'INVALID_IMAGE','Use a JPEG, PNG or WebP under 1 MB and twelve megapixels');}finally{decoding--;}
  }
  return this.auth.transaction(async tx=>{
   await requireBusiness(this.auth,tx,ctx,businessId,'catalogue.manage');
   const changed=await tx.product.updateMany({where:{id:productId,businessId,revision},data:{revision:{increment:1}}});
   if(!changed.count)throw new ApiError(409,'REVISION_CONFLICT','Reload before saving');
   if(data===null)await tx.productImage.deleteMany({where:{productId,businessId}});
   else await tx.productImage.upsert({where:{productId},create:{businessId,productId,data},update:{data}});
   await tx.authAudit.create({data:{userId:ctx.user.id,businessId,action:data?'product.image_saved':'product.image_removed',targetId:productId}});
   return {revision:revision+1};
  });
 }
}
