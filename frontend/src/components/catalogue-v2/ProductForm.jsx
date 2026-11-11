import { useState } from 'react';
import { Field, inputClass } from '../auth-v2/Fields';
import { Feedback, Modal, Select, buttonClass, primaryClass } from '../business-v2/UI';
export default function ProductForm({ product, cost, path, api, c, lang, close, done, returnFocus }) {
  const [form,setForm]=useState(product ? {...product,barcodes:product.barcodes.join('\n')} : {name:'',sku:'',unit:'PIECE',category:'',subcategory:'',brand:'',description:'',purchasePrice:'',sellingPrice:'',minimumStock:'0',active:true,barcodes:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const set=key=>e=>setForm(f=>({...f,[key]:e.target.value}));
  async function save(e){
    e.preventDefault();setBusy(true);setError('');
    const body=Object.fromEntries(['name','category','subcategory','brand','description','sellingPrice','minimumStock','active',...(cost?['purchasePrice']:[])].map(k=>[k,form[k]]));
    body.barcodes=form.barcodes.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
    if(product)body.revision=product.revision;else{body.sku=form.sku;body.unit=form.unit;}
    try{await api(product?`${path}/${product.id}`:path,{method:product?'PATCH':'POST',body});done();}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <Modal title={c(product?'editProduct':'addProduct')} description={c('productFormHint')} {...{close,returnFocus,c,lang,busy}}>
    <form onSubmit={save} className="space-y-4"><Feedback error={error} c={c} retry={error==='REVISION_CONFLICT'?()=>done(false):undefined}/>
      <fieldset disabled={busy||error==='REVISION_CONFLICT'} className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><Field id="product-name" label={c('productName')} placeholder={c('productNamePlaceholder')} value={form.name} onChange={set('name')} required minLength={2} maxLength={160}/></div>
        {!product && <><Field id="product-sku" label={c('sku')} placeholder="MILK-001" dir="ltr" value={form.sku} onChange={set('sku')} required minLength={2} maxLength={60}/><Select id="product-unit" label={c('unit')} value={form.unit} onChange={set('unit')}>{['PIECE','BOX','CARTON','KG','LITRE','METRE'].map(v=><option key={v} value={v}>{c(v)}</option>)}</Select></>}
        {['category','subcategory','brand'].map(k=><Field key={k} id={`product-${k}`} label={c(k)} placeholder={c(`${k}Placeholder`)} value={form[k]} onChange={set(k)} maxLength={80}/>)}
        {['sellingPrice',...(cost?['purchasePrice']:[]),'minimumStock'].map(k=><Field key={k} id={`product-${k}`} label={c(k)} placeholder={k==='minimumStock'?'0':'0.0000'} value={form[k]} onChange={set(k)} dir="ltr" inputMode="decimal" required pattern="(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?" />)}
        <div className="sm:col-span-2"><label htmlFor="product-barcodes" className="block text-sm font-medium text-slate-700 mb-1.5">{c('barcodes')}</label><textarea id="product-barcodes" className={inputClass} dir="ltr" placeholder="001234567890" value={form.barcodes} onChange={set('barcodes')} rows={3} maxLength={2600} aria-describedby="barcode-hint"/><p id="barcode-hint" className="text-xs text-slate-500 mt-1">{c('barcodeHint')}</p></div>
        <div className="sm:col-span-2"><Field id="product-description" label={c('description')} placeholder={c('descriptionPlaceholder')} value={form.description} onChange={set('description')} maxLength={2000}/></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-emerald-600 h-4 w-4" checked={form.active} onChange={e=>setForm(f=>({...f,active:e.target.checked}))}/>{c('active')}</label>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={close}>{c('cancel')}</button><button className={primaryClass} disabled={busy||error==='REVISION_CONFLICT'}>{c(busy?'saving':'save')}</button></div>
    </form>
  </Modal>;
}
