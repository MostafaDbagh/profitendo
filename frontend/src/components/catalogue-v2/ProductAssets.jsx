import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { useRef, useState } from 'react';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Modal, buttonClass } from '../business-v2/UI';
export default function ProductAssets({title,product,path,api,c,lang,close,returnFocus}){
 const fileInput=useRef(null);
 const t=(en,ar)=>lang==='ar'?ar:en,url=`${path}/${product.id}`;
 const image=useResource(api,`${url}/image`);
 const [pendingImage,setPendingImage]=useState(null),[revision,setRevision]=useState(product.revision),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const draft=useLocalDraft(`product-pack:${product.id}`,{pendingImage},saved=>setPendingImage(saved.pendingImage));
 async function run(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function saveImage(file){
  if(file&&file.size>1024*1024)throw new Error(t('Choose an image under 1 MB.','اختر صورة بحجم أقل من ١ ميغابايت.'));
  const base64=file?await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('Image read failed'));reader.readAsDataURL(file);}):null;
  if(file){const pending={name:file.name,base64};setPendingImage(pending);draft.checkpoint({pendingImage:pending});}
  await uploadImage(base64);
 }
 async function uploadImage(base64){
  const result=await api(`${url}/image`,{method:'PUT',body:{revision,fileBase64:base64}});setRevision(result.revision);setPendingImage(null);draft.clear();image.reload();
 }
 return <Modal title={title} description={product.name} {...{c,lang,close,returnFocus,busy}}>
  <div className="space-y-5"><LocalDraftNotice {...{draft,lang,busy}}/><Feedback error={error||image.error} c={c}/>
   <section className="space-y-3"><h3 className="font-semibold">{t('Product image','صورة المنتج')}</h3>{image.data?.dataUrl&&<img src={image.data.dataUrl} alt={product.name} className="h-32 w-32 object-contain rounded-lg border border-slate-200"/>}
    {pendingImage&&<div className="space-y-2 text-sm"><p className="break-all">{t('Unfinished image upload:','تحميل صورة غير مكتمل:')} {pendingImage.name}</p><button type="button" className={buttonClass} disabled={busy} onClick={()=>run(()=>uploadImage(pendingImage.base64))}>{t('Retry image upload','إعادة محاولة تحميل الصورة')}</button></div>}<label htmlFor="product-image" className="block text-sm">{t('JPEG, PNG or WebP · up to 1 MB / 12 megapixels','JPEG أو PNG أو WebP · حتى ١ ميغابايت / ١٢ ميغابكسل')}</label><button type="button" className={buttonClass} disabled={busy} onClick={()=>fileInput.current?.click()}>{t('Choose image','اختيار صورة')}</button><input ref={fileInput} tabIndex={-1} id="product-image" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)run(()=>saveImage(file));e.target.value='';}}/>
    {image.data?.dataUrl&&<button className={buttonClass} disabled={busy} onClick={()=>run(()=>saveImage(null))}>{t('Remove image','إزالة الصورة')}</button>}
   </section>
  </div>
 </Modal>;
}
