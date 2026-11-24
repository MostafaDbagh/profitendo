import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import {LocationChipGroup,locationIcons} from '../business-v2/LocationChips';
import SaleSteps from './SaleSteps';
import {OptionalFields} from '../business-v2/Disclosure';
import { selectInputOnFocus } from '../../lib/selectInputOnFocus';
import { Check, MapPin, Barcode, Plus, ShoppingBasket, Trash2 } from 'lucide-react';
import useLocationOptions from '../business-v2/useLocationOptions';
import { formatQuantity } from '@/lib/quantity';
import CopyableCode from '@/components/CopyableCode';
import { percentageRow, discountPayload } from './discount';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { unitLabel } from '../catalogue-v2/units';
import { useEffect,useRef,useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { Feedback,Pager,Select,buttonClass,primaryClass,panelClass } from '../business-v2/UI';
import ProductSearch from '../operations-v2/ProductSearch';
const scale=v=>{const [a,b='']=v.split('.');return BigInt(a||0)*10000n+BigInt(b.padEnd(4,'0'));};
const plusOne=v=>{const n=scale(v)+10000n;return `${n/10000n}.${String(n%10000n).padStart(4,'0')}`;};
export default function Editor({context,api,c,lang,doc,done,close}){
 const root=`/businesses/${context.business.id}`;
 const path=`${root}/sales`,[requestedShop,setShop]=useState(null),[rows,setRows]=useState(doc?.lines.map(l=>percentageRow({...l,quantity:formatQuantity(l.quantity),key:crypto.randomUUID(),packs:[...(l.availablePacks??[]),...(l.packId&&!l.availablePacks?.some(p=>p.id===l.packId)?[{id:l.packId,name:l.packName,baseQuantity:l.factor}]:[])]}))||[]),[customer,setCustomer]=useState(doc?.customerName||''),[notes,setNotes]=useState(doc?.notes||''),[barcode,setBarcode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(0);
 const [shopPage,setShopPage]=useState(1);
 const shops=useLocationOptions(api,doc?null:`${root}/locations?state=active`);
 const availableShop=shops.items.find(item=>item.id===requestedShop?.id);
 const shop=doc?{id:doc.locationId,name:doc.locationName}:availableShop;
 const onlyShop=shops.items.length===1?shops.items[0]:null;
 const shopUnavailable=!doc&&requestedShop&&!availableShop&&!shops.loading&&!shops.error;
 useEffect(()=>{
  if(!doc&&!rows.length&&!pending&&!availableShop&&(onlyShop||shopUnavailable))setShop(onlyShop);
 },[doc,rows.length,pending,availableShop,onlyShop,shopUnavailable]);
 const shopLocked=!!doc||rows.length>0||pending>0||busy;
 const pageSize=shops.pageSize??25;
 const shopOptions=shopLocked&&shop?[shop]:shops.items.slice((shopPage-1)*pageSize,shopPage*pageSize);
 const productInput=useRef(null),scanner=useRef(null),queue=useRef(Promise.resolve()),key=useRef(crypto.randomUUID()),request=useRef(null);
 const draft=useLocalDraft(`sale:${doc?.id||'new'}:${doc?.revision||0}`,{shop:requestedShop,rows,customer,notes,barcode,clientKey:key.current,fingerprint:request.current},saved=>{setShop(saved.shop);setRows(saved.rows.map(row=>percentageRow({...row,quantity:formatQuantity(row.quantity)})));setCustomer(saved.customer);setNotes(saved.notes);setBarcode(saved.barcode);key.current=saved.clientKey;request.current=saved.fingerprint;});
 const change=(id,patch)=>setRows(old=>old.map(r=>r.key===id?{...r,...patch,...(['discountPercent','quantity','packId'].some(k=>k in patch)?{legacyDiscount:undefined}:{})}:r));
 function add(p){setRows(old=>{const same=old.find(r=>r.productId===p.id&&!r.packId);if(same){if(!/^(0|[1-9]\d{0,12})(\.\d{1,4})?$/.test(same.quantity)){setError('VALIDATION_ERROR');return old;}return old.map(r=>r.key===same.key?{...r,quantity:formatQuantity(plusOne(r.quantity)),legacyDiscount:undefined}:r);}return [...old,{key:crypto.randomUUID(),productId:p.id,name:p.name,sku:p.sku,unit:p.unit,quantity:'1',packId:null,packs:p.packs,unitPrice:p.sellingPrice,available:p.available,discountPercent:'0',discountReason:''}];});}
 function scan(e){e.preventDefault();const value=barcode.trim();if(!value||!shop)return;setBarcode('');setPending(n=>n+1);queue.current=queue.current.then(async()=>{try{const data=await api(`${path}/products?locationId=${shop.id}&barcode=${encodeURIComponent(value)}`);if(!data.items.length)throw new Error('PRODUCT_NOT_FOUND');add(data.items[0]);setError('');}catch(e){setError(e.message);}finally{setPending(n=>n-1);scanner.current?.querySelector("input")?.focus();}});}
 const requested=new Map();
 const available=new Map();
 for(const row of rows){
  if(row.available!==undefined)available.set(row.productId,row.available);
  const factor=String(row.packs.find(pack=>pack.id===row.packId)?.baseQuantity??'1');
  if(/^\d+(\.\d{1,4})?$/.test(row.quantity)){
   requested.set(row.productId,(requested.get(row.productId)??0n)+scale(row.quantity)*scale(factor));
  }
 }
 const exceedsStock=productId=>available.has(productId)&&(requested.get(productId)??0n)>scale(String(available.get(productId)))*10000n;
 const insufficientStock=rows.some(row=>exceedsStock(row.productId));
 async function save(e){e.preventDefault();if(!shop||insufficientStock)return;setBusy(true);setError('');const content={customerName:customer,notes,lines:rows.map(r=>({productId:r.productId,packId:r.packId,quantity:r.quantity,...discountPayload(r),discountReason:r.discountReason}))};const fingerprint=JSON.stringify({...content,locationId:shop.id});if(request.current!==fingerprint){key.current=crypto.randomUUID();request.current=fingerprint;}draft.checkpoint({clientKey:key.current,fingerprint:request.current});
 try{const result=await api(doc?`${path}/${doc.id}`:path,{method:doc?'PATCH':'POST',body:doc?{...content,revision:doc.revision}:{...content,locationId:shop.id,clientKey:key.current}});draft.clear();done(result);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <PageLayout as="div" className="mx-auto w-full max-w-5xl"><PageHeader title={c(doc?'saleEdit':'newSale')} accessory={<button className={buttonClass} disabled={busy||pending>0} onClick={close}>{c('close')}</button>}/><SaleSteps step={0} lang={lang}/><LocalDraftNotice {...{draft,lang,busy}}/><Feedback {...{c,error}}/>
 <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="min-w-0 space-y-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
  <LocationChipGroup label={c('chooseLocation')} required>
   {!doc&&<Feedback error={shops.error} c={c} retry={shops.reload}/>}
   {!doc&&shops.loading&&<LoadingState className="text-sm text-slate-500">{c('loading')}</LoadingState>}
   {!doc&&!shops.loading&&!shops.error&&!shops.items.length&&<p className="text-sm text-slate-500">{lang==='ar'?'لا توجد مواقع متاحة للبيع.':'No locations are available for sales.'}</p>}
   {shopUnavailable&&rows.length>0&&<p role="status" className="text-sm text-slate-600">{lang==='ar'?'لم يعد موقع المسودة متاحًا. أزل أصنافها لاختيار موقع آخر.':'The draft location is no longer available. Remove its items to choose another location.'}</p>}
   {shopOptions.map(option=>{
    const selected=option.id===shop?.id, Icon=locationIcons[option.kind]??MapPin;
    return <button key={option.id} type="button" aria-pressed={selected} disabled={shopLocked}
     className={`inline-flex max-w-full min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-emerald-500 ${selected?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
     onClick={()=>setShop(option)}>
     <Icon aria-hidden="true" className="h-4 w-4 shrink-0"/>
     <bdi className="min-w-0 break-words">{option.name}</bdi>{selected&&<Check aria-hidden="true" className="h-4 w-4 shrink-0"/>}

    </button>;
   })}
  </LocationChipGroup>
  {!shopLocked&&shops.items.length>pageSize&&<Pager data={{page:shopPage,pageSize,total:shops.items.length}} setPage={setShopPage} c={c}/>}
 </div>
 <div className="space-y-3 p-4 sm:p-5">
  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ShoppingBasket className="h-4 w-4 text-emerald-600" aria-hidden="true"/>{lang==='ar'?'إضافة منتجات للبيع':'Add sale items'}</div>
  <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
   <form ref={scanner} onSubmit={scan} className="min-w-0">
    <label htmlFor="pos-barcode" className="mb-1.5 block text-xs font-medium text-slate-600">{lang==='ar'?'الباركود أو رمز الصنف':'Barcode or SKU'}</label>
    <div className="flex gap-2"><div className="relative min-w-0 flex-1"><Barcode aria-hidden="true" className="pointer-events-none absolute start-3 top-3.5 h-5 w-5 text-slate-400"/><input id="pos-barcode" className="h-12 w-full rounded-lg border border-slate-200 bg-white ps-10 pe-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder={lang==='ar'?'امسح الباركود أو اكتب الرمز':'Scan barcode or enter code'} value={barcode} onChange={e=>setBarcode(e.target.value)} disabled={!shop||busy} autoComplete="off" maxLength={100}/></div>
    <button className={`${buttonClass} h-12 shrink-0`} disabled={!shop||busy||!barcode.trim()}><Plus className="h-4 w-4" aria-hidden="true"/>{lang==='ar'?'إضافة':'Add'}</button></div>
   </form>
   <ProductSearch key={shop?.id} {...{api,root,c,lang,context}} lookupPath={`${path}/products?locationId=${shop?.id}`}
    disabled={!shop||busy||pending>0} maxLength={100} selectCreated={false} onSelect={add} inputRef={productInput}/>
  </div>
  {pending>0&&<LoadingState className="text-xs text-emerald-700">{c('loading')}</LoadingState>}
 </div></section>

 <form onSubmit={save} className="space-y-5"><fieldset disabled={busy||pending>0} className="space-y-4 min-w-0"><legend className="font-semibold mb-3">{c('saleItems')} ({rows.length})</legend>{!rows.length&&<div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500"><ShoppingBasket className="h-6 w-6 shrink-0 text-slate-400" aria-hidden="true"/><p>{c('saleEmpty')}</p></div>}
 {rows.map((r,i)=><div key={r.key} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-start">
 <div className="min-w-0 sm:col-span-2 xl:col-span-1"><p className="mb-2 text-xs font-medium text-slate-500">{lang==='ar'?'المنتج':'Product'}</p><h3 className="font-semibold break-words text-slate-900">{r.name}</h3><div className="mt-1 text-xs text-slate-500"><CopyableCode>{r.sku}</CopyableCode></div></div>
 <Select id={`sale-pack-${i}`} label={c('salePack')} value={r.packId||''} onChange={e=>{const packId=e.target.value||null;if(rows.some(x=>x.key!==r.key&&x.productId===r.productId&&x.packId===packId)){setError('VALIDATION_ERROR');return;}change(r.key,{packId});}}><option value="">{unitLabel(r.unit,c)}</option>{r.packs.map(p=><option key={p.id} value={p.id}>{p.name} ({formatQuantity(p.baseQuantity)} {unitLabel(r.unit,c)})</option>)}</Select><div className="space-y-1"><Field id={`sale-quantity-${i}`} {...selectInputOnFocus} label={c('saleQuantity')} placeholder={lang==='ar'?'مثال: 2.5':'e.g. 2.5'} value={r.quantity} onChange={e=>change(r.key,{quantity:e.target.value})} inputMode="decimal" pattern="(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?" required />
 {available.has(r.productId)&&<span className="block text-xs text-slate-600">
  {lang==='ar'?'إجمالي الكمية المتاحة في الموقع':'Total available quantity at this location'}: <bdi className="font-semibold">{formatQuantity(available.get(r.productId))}</bdi> {unitLabel(r.unit,c)}
 </span>}
 {exceedsStock(r.productId)&&<p role="alert" className="text-sm text-red-700">
  {lang==='ar'?'الكمية المطلوبة أكبر من المتاح في هذا الموقع.':'Requested quantity exceeds available stock at this location.'}{' '}
  {c('saleAvailable')}: <bdi>{formatQuantity(available.get(r.productId))}</bdi> {unitLabel(r.unit,c)}
 </p>}</div>
 <div><p className="mb-1.5 text-sm font-medium text-slate-700">{lang==='ar'?'سعر الوحدة الأساسية':'Base-unit price'}</p><div className="min-h-11 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700"><bdi>{r.unitPrice}</bdi> <span className="text-xs font-normal">{context.business.baseCurrency}</span></div></div>
 <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500 xl:mt-7" aria-label={`${c('saleRemove')}: ${r.name}`} onClick={()=>setRows(old=>old.filter(l=>l.key!==r.key))}><Trash2 className="h-4 w-4" aria-hidden="true"/></button>
 {context.permissions['sales.discount']&&<OptionalFields className="sm:col-span-2 xl:col-span-5" title={lang==='ar'?'إضافة خصم (اختياري)':'Add discount (optional)'} hasValue={Boolean(Number(r.discountPercent)||Number(r.legacyDiscount)||r.discountReason)}><div className="grid gap-4 sm:grid-cols-2"><Field id={`sale-discount-${i}`} label={`${c('saleDiscount')} (%)`} placeholder="0" value={r.discountPercent} onChange={e=>change(r.key,{discountPercent:e.target.value})} onFocus={e=>{if(Number(e.currentTarget.value)===0)e.currentTarget.select();}} inputMode="decimal" pattern="(0|[1-9][0-9]?)(\.[0-9]{1,4})?|100(\.0{1,4})?" hint={lang==='ar'?'نسبة من إجمالي الصنف قبل الضريبة، من 0 إلى 100%.':'Percentage of the item subtotal before tax, from 0 to 100%.'} required/><Field id={`sale-reason-${i}`} label={c('saleReason')} placeholder={c('saleReasonPlaceholder')} value={r.discountReason} onChange={e=>change(r.key,{discountReason:e.target.value})} required={Number(r.discountPercent)>0} minLength={Number(r.discountPercent)>0?5:undefined} maxLength={500}/></div></OptionalFields>}</div></div>)}
 <button type="button" className={`${buttonClass} border-dashed !text-emerald-700`} disabled={!shop||busy||pending>0} onClick={()=>productInput.current?.focus()}><Plus className="h-4 w-4" aria-hidden="true"/>{lang==='ar'?'إضافة صنف':'Add item'}</button>
 <OptionalFields title={lang==='ar'?'العميل والملاحظات (اختياري)':'Customer & notes (optional)'} hasValue={Boolean(customer||notes)}><div className="grid sm:grid-cols-2 gap-4"><Field id="sale-customer" label={c('saleCustomer')} placeholder={c('saleCustomerPlaceholder')} value={customer} onChange={e=>setCustomer(e.target.value)} maxLength={150}/><Field id="sale-notes" label={c('saleNotes')} placeholder={c('saleNotesPlaceholder')} value={notes} onChange={e=>setNotes(e.target.value)} maxLength={2000}/></div></OptionalFields></fieldset><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-white p-4"><span className="text-sm text-slate-600">{c('saleItems')}: <bdi className="font-bold text-slate-900">{rows.length}</bdi></span><button className={`${primaryClass} min-h-11`} disabled={!shop||!rows.length||busy||pending>0||insufficientStock}>{c(busy?'saving':doc?'refreshSale':'reviewSale')}</button></div></form>
 </PageLayout>;
}
