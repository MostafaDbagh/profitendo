import { formatQuantity } from '@/lib/quantity';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { useResource } from '../business-v2/useBusinessApi';
import { useState } from 'react';
import { Field, inputClass } from '../auth-v2/Fields';
import { Feedback, Modal, Select, buttonClass, primaryClass } from '../business-v2/UI';
function requiredLabel(label) {
  return <>{label} <span className="text-red-600" aria-hidden="true">*</span></>;
}

export default function ProductForm({canDelete, product, cost, path, api, c, lang, close, done, returnFocus }) {
  const [categoriesOpen,setCategoriesOpen]=useState(false);
  const references=useResource(api,`${path}/references`);
  const categories=references.data?.items.filter(r=>r.kind==='CATEGORY'&&r.active)||[];
  const [form,setForm]=useState(product ? {...product,minimumStock:formatQuantity(product.minimumStock).replace(/^0$/, ''),barcodes:product.barcodes.join('\n')} : {name:'',sku:'',unit:'PIECE',category:'',subcategory:'',brand:'',description:'',purchasePrice:'',sellingPrice:'',minimumStock:'',active:true,barcodes:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const draft=useLocalDraft(`product:${product?.id||'new'}:${product?.revision||0}`,{form},saved=>{setForm({...saved.form,minimumStock:formatQuantity(saved.form.minimumStock).replace(/^0$/, '')});});
  const set=key=>e=>setForm(f=>({...f,[key]:e.target.value}));
  async function save(e){
    e.preventDefault();setBusy(true);setError('');
    const body=Object.fromEntries(['name','category','subcategory','brand','description','sellingPrice','minimumStock','active',...(cost?['purchasePrice']:[])].map(k=>[k,form[k]]));
    if (product) body.minimumStock ||= '0';
    if (cost && !body.purchasePrice) delete body.purchasePrice;
    body.barcodes=form.barcodes.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
    if(product)body.revision=product.revision;else{if(form.sku.trim())body.sku=form.sku;body.unit=form.unit;}
    try{await api(product?`${path}/${product.id}`:path,{method:product?'PATCH':'POST',body});draft.clear();done();}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <Modal title={c(product?'editProduct':'addProduct')} description={c('productFormHint')} {...{close,returnFocus,c,lang,busy}}>
    <form onSubmit={save} className="space-y-4"><LocalDraftNotice {...{draft,lang,busy}}/><Feedback error={error} c={c} retry={error==='REVISION_CONFLICT'?()=>done(false):undefined}/>
      <fieldset disabled={busy||error==='REVISION_CONFLICT'} className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><Field id="product-name" label={requiredLabel(c('productName'))} placeholder={c('productNamePlaceholder')} value={form.name} onChange={set('name')} required minLength={2} maxLength={160}/></div>
        {!product && <><Field id="product-sku" label={c('sku')} placeholder="MILK-001" dir="ltr" value={form.sku} onChange={set('sku')} minLength={2} maxLength={60}/><Select id="product-unit" label={requiredLabel(c('unit'))} value={form.unit} required onChange={set('unit')}>{[...['PIECE','BOX','CARTON','KG','LITRE','METRE'],...(references.data?.items.filter(r=>r.kind==='UNIT'&&r.active).map(r=>r.code)||[])].map(v=><option key={v} value={v}>{references.data?.items.find(r=>r.kind==='UNIT'&&r.code===v)?.name||c(v)}</option>)}</Select></>}
        <Popover open={categoriesOpen} onOpenChange={setCategoriesOpen}>
          <PopoverAnchor asChild>
            <div className="relative">
              <Field id="product-category" label={product ? c('category') : requiredLabel(c('category'))} required={!product} pattern={product ? undefined : '.*\\S.*'} placeholder={c('categoryPlaceholder')}
                value={form.category} onChange={set('category')} maxLength={80}
                className={inputClass.replace('px-3', 'ps-3 pe-11')}/>
              <PopoverTrigger asChild>
                <button type="button" disabled={!categories.length || busy || error==='REVISION_CONFLICT'} aria-label={lang==='ar'?'عرض الفئات':'Show categories'}
                  className="absolute bottom-1 end-1 flex h-8 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50">
                  <ChevronDown aria-hidden="true" className="h-4 w-4"/>
                </button>
              </PopoverTrigger>
            </div>
          </PopoverAnchor>
          <PopoverContent dir={lang==='ar'?'rtl':'ltr'}
            className="max-h-56 w-[var(--radix-popover-anchor-width)] overflow-y-auto rounded-lg border-slate-200 bg-white p-1 text-start">
            {categories.map(r=>(
              <button key={r.id} type="button"
                className="block w-full rounded-md px-3 py-2 text-start text-sm text-slate-700 hover:bg-emerald-50 focus-visible:bg-emerald-50"
                onClick={()=>{setForm(current=>({...current,category:r.name}));setCategoriesOpen(false);}}>
                {r.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        {['subcategory','brand'].map(k=><Field key={k} id={`product-${k}`} label={c(k)} placeholder={c(`${k}Placeholder`)} value={form[k]} onChange={set(k)} maxLength={80}/>)}
        {['sellingPrice',...(cost?['purchasePrice']:[]),'minimumStock'].map(k=><Field key={k} id={`product-${k}`} label={k==='sellingPrice'||(k==='minimumStock'&&!product)?requiredLabel(c(k)):c(k)} placeholder={k==='minimumStock'?'0':'0.0000'} value={form[k]} onChange={set(k)} dir="ltr" inputMode="decimal" required={k==='sellingPrice'||(k==='minimumStock'&&!product)} pattern="(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?" />)}
        <div className="sm:col-span-2"><label htmlFor="product-barcodes" className="block text-sm font-medium text-slate-700 mb-1.5">{c('barcodes')}</label><textarea id="product-barcodes" className={inputClass} dir="ltr" placeholder="001234567890" value={form.barcodes} onChange={set('barcodes')} rows={3} maxLength={2600} aria-describedby="barcode-hint"/><p id="barcode-hint" className="text-xs text-slate-500 mt-1">{c('barcodeHint')}</p></div>
        <div className="sm:col-span-2"><label htmlFor="product-description" className="text-sm font-medium text-slate-700 mb-1.5 block">{c('description')}</label><textarea id="product-description" className={`${inputClass} min-h-32 resize-y`} rows={4} placeholder={c('descriptionPlaceholder')} value={form.description} onChange={set('description')} maxLength={2000}/></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-emerald-600 h-4 w-4" disabled={!!product && product.active && !canDelete} checked={form.active} onChange={e=>setForm(f=>({...f,active:e.target.checked}))}/>{c('active')}</label>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2 rtl:flex-row-reverse"><button type="button" className={buttonClass} disabled={busy} onClick={close}>{c('cancel')}</button><button className={primaryClass} disabled={busy||error==='REVISION_CONFLICT'}>{c(busy?'saving':'save')}</button></div>
    </form>
  </Modal>;
}
