import { unitLabel } from '../catalogue-v2/units';
import { useRef, useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Modal, buttonClass, primaryClass } from '../business-v2/UI';
export default function ProductAssets({product,path,api,c,lang,close,returnFocus}){
 const fileInput=useRef(null);
 const t=(en,ar)=>lang==='ar'?ar:en,url=`${path}/${product.id}`;
 const packs=useResource(api,`${url}/packs`),image=useResource(api,`${url}/image`);
 const [revision,setRevision]=useState(product.revision),[name,setName]=useState(''),[quantity,setQuantity]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retire,setRetire]=useState(null);
 async function run(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function saveImage(file){
  if(file&&file.size>1024*1024)throw new Error(t('Choose an image under 1 MB.','اختر صورة بحجم أقل من ١ ميغابايت.'));
  const base64=file?await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('Image read failed'));reader.readAsDataURL(file);}):null;
  const result=await api(`${url}/image`,{method:'PUT',body:{revision,fileBase64:base64}});setRevision(result.revision);image.reload();
 }
 return <Modal title={t('Packs & image','العبوات والصورة')} description={product.name} {...{c,lang,close,returnFocus,busy}}>
  <div className="space-y-5"><Feedback error={error||packs.error||image.error} c={c}/>
   <section className="space-y-3"><h3 className="font-semibold">{t('Product image','صورة المنتج')}</h3>{image.data?.dataUrl&&<img src={image.data.dataUrl} alt={product.name} className="h-32 w-32 object-contain rounded-lg border border-slate-200"/>}
    <label htmlFor="product-image" className="block text-sm">{t('JPEG, PNG or WebP · up to 1 MB / 12 megapixels','JPEG أو PNG أو WebP · حتى ١ ميغابايت / ١٢ ميغابكسل')}</label><button type="button" className={buttonClass} disabled={busy} onClick={()=>fileInput.current?.click()}>{t('Choose image','اختيار صورة')}</button><input ref={fileInput} tabIndex={-1} id="product-image" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)run(()=>saveImage(file));e.target.value='';}}/>
    {image.data?.dataUrl&&<button className={buttonClass} disabled={busy} onClick={()=>run(()=>saveImage(null))}>{t('Remove image','إزالة الصورة')}</button>}
   </section>
   <section className="space-y-3"><h3 className="font-semibold">{t('Pack definitions','تعريف العبوات')}</h3><p className="text-sm text-slate-500">{t('Factors stay fixed. Retire an old pack, then add its replacement with a new name.','تبقى معاملات التحويل ثابتة. أوقف العبوة القديمة ثم أضف بديلها باسم جديد.')}</p>
    {!packs.data&&<p role="status">{c('loading')}</p>}{packs.data?.items.length===0&&<p>{t('No packs yet.','لا توجد عبوات بعد.')}</p>}
    <ul className="divide-y divide-slate-100">{packs.data?.items.map(p=><li key={p.id} className="py-3 flex flex-wrap gap-2 items-center justify-between"><span>{p.name} · <bdi>{p.baseQuantity}</bdi> {unitLabel(packs.data.baseUnit,c)}</span>{p.retiredAt?<span className="text-sm text-slate-500">{t('Retired','متوقفة')}</span>:<button className={buttonClass} disabled={busy} onClick={()=>setRetire(p)}>{t('Retire','إيقاف')}</button>}</li>)}</ul>
    {retire&&<div className="border border-amber-200 rounded-lg p-3 space-y-2"><p>{t('Stop using this pack for new entries? Historical records stay unchanged.','إيقاف استخدام هذه العبوة في الإدخالات الجديدة؟ تبقى السجلات السابقة دون تغيير.')} {retire.name}</p><div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={()=>setRetire(null)}>{c('cancel')}</button><button className={primaryClass} disabled={busy} onClick={()=>run(async()=>{await api(`${url}/packs/${retire.id}/retire`,{method:'POST',body:{confirm:true}});setRetire(null);packs.reload();})}>{t('Confirm retirement','تأكيد الإيقاف')}</button></div></div>}
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();run(async()=>{await api(`${url}/packs`,{method:'POST',body:{name,baseQuantity:quantity}});setName('');setQuantity('');packs.reload();});}}><Field id="pack-name" label={t('Pack name','اسم العبوة')} placeholder={t('e.g. Carton of 12','مثال: كرتونة من ١٢ قطعة')} value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={80} disabled={busy}/><Field id="pack-factor" label={t('Base units per pack','عدد الوحدات الأساسية في العبوة')} placeholder="12" value={quantity} onChange={e=>setQuantity(e.target.value)} required inputMode="decimal" pattern="(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?" disabled={busy}/><button className={primaryClass} disabled={busy}>{t('Add pack','إضافة عبوة')}</button></form>
   </section>
  </div>
 </Modal>;
}
