import {PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import {basketTotal} from './basketTotal';
import {currencyFormatter} from '../../lib/currencyFormat';
import SaleCatalog from './SaleCatalog';
import {OptionalFields} from '../business-v2/Disclosure';
import { selectInputOnFocus } from '../../lib/selectInputOnFocus';
import { Barcode, ChevronDown, Plus, ShoppingBasket, Store, Trash2 } from 'lucide-react';
import useLocationOptions from '../business-v2/useLocationOptions';
import { formatQuantity } from '@/lib/quantity';
import CopyableCode from '@/components/CopyableCode';
import { percentageRow, discountPayload } from './discount';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { unitLabel } from '../catalogue-v2/units';
import { useEffect,useRef,useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { Feedback,Select,buttonClass,primaryClass } from '../business-v2/UI';

const scale=v=>{const [a,b='']=v.split('.');return BigInt(a||0)*10000n+BigInt(b.padEnd(4,'0'));};
const plusOne=v=>{const n=scale(v)+10000n;return `${n/10000n}.${String(n%10000n).padStart(4,'0')}`;};
export default function Editor({context,api,c,lang,doc,done,close}){
 const root=`/businesses/${context.business.id}`;
 const path=`${root}/sales`,[requestedShop,setShop]=useState(null),[rows,setRows]=useState(doc?.lines.map(l=>percentageRow({...l,quantity:formatQuantity(l.quantity),key:crypto.randomUUID(),packs:[...(l.availablePacks??[]),...(l.packId&&!l.availablePacks?.some(p=>p.id===l.packId)?[{id:l.packId,name:l.packName,baseQuantity:l.factor}]:[])]}))||[]),[customer,setCustomer]=useState(doc?.customerName||''),[customerPhone,setCustomerPhone]=useState(doc?.customerPhone||''),[notes,setNotes]=useState(doc?.notes||''),[barcode,setBarcode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(0);
 const shops=useLocationOptions(api,doc?null:`${root}/locations?state=active`);
 const availableShop=shops.items.find(item=>item.id===requestedShop?.id);
 const shop=doc?{id:doc.locationId,name:doc.locationName}:availableShop;
 const onlyShop=shops.items.length===1?shops.items[0]:null;
 const shopUnavailable=!doc&&requestedShop&&!availableShop&&!shops.loading&&!shops.error;
 useEffect(()=>{
  if(!doc&&!rows.length&&!pending&&!availableShop&&(onlyShop||shopUnavailable))setShop(onlyShop);
 },[doc,rows.length,pending,availableShop,onlyShop,shopUnavailable]);
 const shopLocked=!!doc||rows.length>0||pending>0||busy;
 const productInput=useRef(null),scanner=useRef(null),queue=useRef(Promise.resolve()),key=useRef(crypto.randomUUID()),request=useRef(null);
 const draft=useLocalDraft(`sale:${doc?.id||'new'}:${doc?.revision||0}`,{shop:requestedShop,rows,customer,...(customerPhone!== (doc?.customerPhone||'')?{customerPhone}:{}),notes,barcode,clientKey:key.current,fingerprint:request.current},saved=>{setShop(saved.shop);setRows(saved.rows.map(row=>percentageRow({...row,quantity:formatQuantity(row.quantity)})));setCustomer(saved.customer);setCustomerPhone(saved.customerPhone??doc?.customerPhone??'');setNotes(saved.notes);setBarcode(saved.barcode);key.current=saved.clientKey;request.current=saved.fingerprint;});
 const change=(id,patch)=>setRows(old=>old.map(r=>r.key===id?{...r,...patch,...(['discountPercent','quantity','packId'].some(k=>k in patch)?{legacyDiscount:undefined}:{})}:r));
 function add(p){setRows(old=>{const same=old.find(r=>r.productId===p.id&&!r.packId);if(same){if(!/^(0|[1-9]\d{0,12})(\.\d{1,4})?$/.test(same.quantity)){setError('VALIDATION_ERROR');return old;}return old.map(r=>r.key===same.key?{...r,quantity:formatQuantity(plusOne(r.quantity)),legacyDiscount:undefined}:r);}return [...old,{key:crypto.randomUUID(),productId:p.id,name:p.name,sku:p.sku,unit:p.unit,quantity:'1',packId:null,packs:p.packs,unitPrice:p.sellingPrice,available:p.available,discountPercent:'0',discountReason:''}];});}
 function scan(e){e.preventDefault();const value=barcode.trim();if(!value||!shop)return;setBarcode('');setPending(n=>n+1);queue.current=queue.current.then(async()=>{try{const data=await api(`${path}/products?locationId=${shop.id}&barcode=${encodeURIComponent(value)}`);if(data.items.length!==1){setBarcode(current=>current||value);return;}add(data.items[0]);setError('');}catch(e){setError(e.message);}finally{setPending(n=>n-1);}});}
 const total=basketTotal(rows,context.business);
 const money=currencyFormatter(lang,{style:'currency',currency:context.business.baseCurrency});
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
 async function save(e){e.preventDefault();if(!shop||insufficientStock)return;setBusy(true);setError('');const content={customerName:customer,...(customerPhone||doc?.customerPhone?{customerPhone}:{}),notes,lines:rows.map(r=>({productId:r.productId,packId:r.packId,quantity:r.quantity,...discountPayload(r),discountReason:r.discountReason}))};const fingerprint=JSON.stringify({...content,locationId:shop.id});if(request.current!==fingerprint){key.current=crypto.randomUUID();request.current=fingerprint;}draft.checkpoint({clientKey:key.current,fingerprint:request.current});
 try{const result=await api(doc?`${path}/${doc.id}`:path,{method:doc?'PATCH':'POST',body:doc?{...content,revision:doc.revision}:{...content,locationId:shop.id,clientKey:key.current}});draft.clear();done(result);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <PageLayout as="div" className="mx-auto w-full max-w-screen-2xl"><header dir={lang==='ar'?'rtl':'ltr'} className="flex h-[78px] items-center gap-2 rounded-xl bg-[#047756] px-3 text-white">
  <h1 className="shrink-0 text-xl font-bold">{doc?c('saleEdit'):lang==='ar'?'بيع':'Sale'}</h1>
  <span aria-hidden="true" className="h-6 w-px shrink-0 bg-white/60"/>
  <div className="relative inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg ring-1 ring-inset ring-white/60 bg-[#047756] px-3 text-white focus-within:ring-2 focus-within:ring-white">
   <Store aria-hidden="true" className="h-5 w-5 shrink-0"/>
   <bdi aria-hidden="true" className="min-w-0 truncate text-sm font-semibold">{shop?.name||c('chooseLocation')}</bdi>
   <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0"/>
   <select id="sale-store" aria-label={c('chooseLocation')} title={shop?.name}
    className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
    value={shop?.id||''} disabled={shopLocked||shops.loading&&!doc}
    onChange={e=>setShop(shops.items.find(item=>item.id===e.target.value)||null)}>
    {!shop&&<option value="">{c('chooseLocation')}</option>}
    {(doc?[shop]:shops.items).map(item=><option key={item.id} value={item.id} dir="auto">{item.name}</option>)}
   </select>
  </div>
  <button className="ms-auto min-h-11 shrink-0 rounded-lg border border-white/60 px-3 font-semibold" disabled={busy||pending>0} onClick={close}>{c('close')}</button>
 </header><LocalDraftNotice {...{draft,lang,busy}}/><Feedback {...{c,error}}/>
   {!doc&&<Feedback error={shops.error} c={c} retry={shops.reload}/>}
   {!doc&&shops.loading&&<LoadingState className="text-sm text-slate-500">{c('loading')}</LoadingState>}
   {!doc&&!shops.loading&&!shops.error&&!shops.items.length&&<p className="text-sm text-slate-500">{lang==='ar'?'لا توجد مواقع متاحة للبيع.':'No locations are available for sales.'}</p>}
   {shopUnavailable&&rows.length>0&&<p role="status" className="text-sm text-slate-600">{lang==='ar'?'لم يعد موقع المسودة متاحًا. أزل أصنافها لاختيار موقع آخر.':'The draft location is no longer available. Remove its items to choose another location.'}</p>}
 <div className="grid items-start gap-4 lg:grid-cols-2"><section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
 <div className="space-y-3 p-4 sm:p-5">
  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ShoppingBasket className="h-4 w-4 text-[#047756]" aria-hidden="true"/>{lang==='ar'?'المنتجات':'Products'}</div>
  <div><form ref={scanner} onSubmit={scan} className="min-w-0">
    <label htmlFor="pos-barcode" className="mb-1.5 block text-xs font-medium text-slate-600">{lang==='ar'?'امسح الباركود أو ابحث عن منتج':'Scan barcode or search products'}</label>
    <div className="flex gap-2"><div className="relative min-w-0 flex-1"><Barcode aria-hidden="true" className="pointer-events-none absolute start-3 top-3.5 h-5 w-5 text-slate-400"/><input ref={productInput} id="pos-barcode" className="h-12 w-full rounded-lg border border-slate-200 bg-white ps-10 pe-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#047756]" placeholder={lang==='ar'?'امسح الباركود أو اكتب الرمز':'Scan barcode or enter code'} value={barcode} onChange={e=>setBarcode(e.target.value)} disabled={!shop||busy} autoComplete="off" maxLength={100}/></div>
    <button className={`${buttonClass} h-12 shrink-0`} disabled={!shop||busy||!barcode.trim()}><Plus className="h-4 w-4" aria-hidden="true"/>{lang==='ar'?'إضافة':'Add'}</button></div>
   </form>
  </div>
  {pending>0&&<LoadingState className="text-xs text-[#047756]">{c('loading')}</LoadingState>}
 <SaleCatalog key={shop?.id} {...{api,root,path,shop,context,c,lang,add,busy}} text={barcode} clear={()=>setBarcode('')}/>
 </div></section>

 <form onSubmit={save} className={`flex min-w-0 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${rows.length ? 'h-[min(46rem,84dvh)]' : ''}`}><h2 id="sale-basket-heading" className="font-semibold">{lang==='ar'?'سلة البيع':'Sale basket'} ({rows.length})</h2><fieldset aria-labelledby="sale-basket-heading" disabled={busy||pending>0} className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto">{!rows.length&&<div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500"><ShoppingBasket className="h-6 w-6 shrink-0 text-slate-400" aria-hidden="true"/><p>{lang==='ar'?'السلة فارغة':'Basket is empty'}</p></div>}
 {rows.map((r,i)=><div key={r.key} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><div className="grid min-w-0 gap-4 sm:grid-cols-2  xl:items-start">
 <div className="min-w-0 sm:col-span-2 "><p className="mb-2 text-xs font-medium text-slate-500">{lang==='ar'?'المنتج':'Product'}</p><h3 className="font-semibold break-words text-slate-900">{r.name}</h3><div className="mt-1 text-xs text-slate-500"><CopyableCode>{r.sku}</CopyableCode></div></div>
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
 {context.permissions['sales.discount']&&<OptionalFields className="sm:col-span-2 " title={lang==='ar'?'إضافة خصم (اختياري)':'Add discount (optional)'} hasValue={Boolean(Number(r.discountPercent)||Number(r.legacyDiscount)||r.discountReason)}><div className="grid gap-4 sm:grid-cols-2"><Field id={`sale-discount-${i}`} label={`${c('saleDiscount')} (%)`} placeholder="0" value={r.discountPercent} onChange={e=>change(r.key,{discountPercent:e.target.value})} onFocus={e=>{if(Number(e.currentTarget.value)===0)e.currentTarget.select();}} inputMode="decimal" pattern="(0|[1-9][0-9]?)(\.[0-9]{1,4})?|100(\.0{1,4})?" hint={lang==='ar'?'نسبة من إجمالي الصنف قبل الضريبة، من 0 إلى 100%.':'Percentage of the item subtotal before tax, from 0 to 100%.'} required/><Field id={`sale-reason-${i}`} label={c('saleReason')} placeholder={c('saleReasonPlaceholder')} value={r.discountReason} onChange={e=>change(r.key,{discountReason:e.target.value})} required={Number(r.discountPercent)>0} minLength={Number(r.discountPercent)>0?5:undefined} maxLength={500}/></div></OptionalFields>}</div></div>)}
 <button type="button" className={`${buttonClass} border-dashed !text-[#047756]`} disabled={!shop||busy||pending>0} onClick={()=>productInput.current?.focus()}><Plus className="h-4 w-4" aria-hidden="true"/>{lang==='ar'?'إضافة صنف':'Add item'}</button>
 </fieldset><fieldset disabled={busy||pending>0} className="min-w-0 shrink-0"><OptionalFields title={lang==='ar'?'العميل والملاحظات (اختياري)':'Customer & notes (optional)'}><div className="grid sm:grid-cols-2 gap-4"><Field id="sale-customer" label={c('saleCustomer')} placeholder={c('saleCustomerPlaceholder')} value={customer} onChange={e=>setCustomer(e.target.value)} maxLength={150}/><Field id="sale-customer-phone" placeholder="0912345678" type="tel" dir="ltr" autoComplete="tel" label={lang==='ar'?'رقم هاتف العميل (اختياري)':'Customer phone number (optional)'} value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)} maxLength={40}/><div className="sm:col-span-2"><Field id="sale-notes" label={c('saleNotes')} placeholder={c('saleNotesPlaceholder')} value={notes} onChange={e=>setNotes(e.target.value)} maxLength={2000}/></div></div></OptionalFields></fieldset><div className="flex flex-wrap items-center justify-between gap-3 shrink-0 rounded-xl border border-[#047756]/25 bg-white p-4"><span className="text-sm text-slate-600">{lang==='ar'?'الإجمالي':'Total'}: <bdi className="font-bold text-slate-900">{total===null?'—':money.format(total)}</bdi></span><button className={`${primaryClass} !bg-[#047756] hover:!brightness-90 min-h-11`} disabled={!shop||!rows.length||busy||pending>0||insufficientStock}>{c(busy?'saving':doc?'refreshSale':'reviewSale')}</button></div></form></div>
 </PageLayout>;
}
