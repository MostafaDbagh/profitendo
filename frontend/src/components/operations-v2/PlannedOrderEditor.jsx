import {selectInputOnFocus} from '../../lib/selectInputOnFocus';
import {OptionalFields} from '../business-v2/Disclosure';
import { ArrowRight, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatQuantity } from '@/lib/quantity';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { Field, inputClass } from '../auth-v2/Fields';
import { Feedback, buttonClass, panelClass, primaryClass } from '../business-v2/UI';
import RecordPicker from './RecordPicker';

const newItem = () => ({key:crypto.randomUUID(),name:'',quantity:''});
const quantityPattern = '(0|[1-9][0-9]{0,13})([.][0-9]{1,4})?';

export default function PlannedOrderEditor({context,api,c,lang,document,initialSupplier,close,done,embedded=false,onBusyChange}) {
  const ar=lang==='ar';
  const path=`/businesses/${context.business.id}/operations`;
  const [form,setForm]=useState(()=>({
    clientKey:crypto.randomUUID(),
    documentDate:document?.documentDate??new Intl.DateTimeFormat('en-CA',{timeZone:context.business.timezone}).format(new Date()),
    supplier:document ? (document.supplierId?{id:document.supplierId,name:document.supplierName}:null) : initialSupplier??null,
    notes:document?.notes??'',
    items:document?.plannedItems.map(item=>({key:item.id,name:item.name,quantity:formatQuantity(item.quantity)}))??[newItem()],
  }));
  const [picker,setPicker]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const trigger=useRef(null),request=useRef(null);
  const draft=useLocalDraft(`planned-purchase:${document?.id??'new'}:${document?.revision??0}`,{...form,request:request.current},saved=>{const {request:prior,...fields}=saved;request.current=prior??null;setForm(fields);});
  const change=patch=>setForm(value=>({...value,...patch}));
  const editItem=(key,field,value)=>setForm(current=>({...current,items:current.items.map(item=>item.key===key?{...item,[field]:value}:item)}));
  const valid=form.items.every(item=>item.name.trim()&&/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/.test(item.quantity)&&Number(item.quantity)>0);

  async function save(event) {
    event.preventDefault();
    if(busy||!valid)return;
    setBusy(true);setError('');
    try {
      const fields={documentDate:form.documentDate,supplierId:form.supplier?.id??null,notes:form.notes,
        plannedItems:form.items.map(({name,quantity})=>({name:name.trim(),quantity}))};
      const signature=JSON.stringify(fields);
      if(!request.current||request.current.signature!==signature)
        request.current={signature,key:request.current?crypto.randomUUID():form.clientKey};
      draft.checkpoint({request:request.current});
      const result=await api(document?`${path}/purchases/${document.id}`:`${path}/purchases`,{
        method:document?'PATCH':'POST',
        body:document?{...fields,revision:document.revision}:{...fields,kind:'ORDER',clientKey:request.current.key},
      });
      draft.clear();done(result);
    } catch(e){setError(e.message);}
    finally{setBusy(false);}
  }

  useEffect(()=>{onBusyChange?.(busy);return ()=>onBusyChange?.(false);},[busy,onBusyChange]);
  return <section className="max-w-2xl space-y-5">
    <button type="button" className={buttonClass} disabled={busy} onClick={close}>
      <ArrowRight aria-hidden="true" className="h-4 w-4 ltr:rotate-180"/>{embedded?(ar?'عرض سجل المشتريات':'Show purchase history'):c('back')}
    </button>
    {!embedded&&<div>
      <h2 className="text-lg font-bold">{c(document?'editDocument':'newOrder')}</h2>
    </div>}
    <LocalDraftNotice {...{draft,lang,busy}}/>
    <Feedback {...{error,c}}/>
    <form className={panelClass} onSubmit={save}>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        {form.items.map((item,index)=><div key={item.key} className="grid items-start gap-4 sm:grid-cols-2">
          <Field id={`planned-name-${index}`} label={ar?'اسم المنتج':'Product name'} placeholder={ar?'اكتب اسم المنتج':'Enter product name'}
            value={item.name} onChange={event=>editItem(item.key,'name',event.target.value)} required maxLength={160}/>
          <div className="flex items-start gap-2">
           <div className="min-w-0 flex-1"><Field id={`planned-quantity-${index}`} {...selectInputOnFocus} label={c('quantity')} placeholder="10" dir="ltr" inputMode="decimal" pattern={quantityPattern}
            value={item.quantity} onChange={event=>editItem(item.key,'quantity',event.target.value)} required/></div>
          {form.items.length>1&&<button type="button" className={`${buttonClass} mt-6 shrink-0`} aria-label={`${c('remove')} ${index+1}`}
            onClick={()=>change({items:form.items.filter(row=>row.key!==item.key)})}><X aria-hidden="true" className="h-4 w-4"/></button>}
          </div>
        </div>)}
        <button type="button" className={buttonClass} disabled={form.items.length>=100} onClick={()=>change({items:[...form.items,newItem()]})}>
          <Plus className="h-4 w-4" aria-hidden="true"/>{ar?'إضافة منتج آخر':'Add another product'}
        </button>
        <div className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
          <Field id="planned-order-date" label={ar?'تاريخ طلب الشراء':'Purchase request date'} type="date" value={form.documentDate}
            onChange={event=>change({documentDate:event.target.value})} required/>
          <div className="space-y-1.5">
            <p id="planned-supplier-label" className="text-sm font-medium text-slate-700">{ar?'المورد أو المصدر (اختياري)':'Supplier or source (optional)'}</p>
            <div className="flex gap-2">
              <button type="button" ref={trigger} aria-describedby="planned-supplier-label" className={`${buttonClass} min-w-0 flex-1`}
                onClick={()=>setPicker(true)}>{form.supplier?.name||c('chooseSupplier')}</button>
              {form.supplier&&<button type="button" className={buttonClass} aria-label={c('clearFilter')} onClick={()=>change({supplier:null})}>
                <X aria-hidden="true" className="h-4 w-4"/>
              </button>}
            </div>
          </div>
        </div>
        <OptionalFields hasValue={Boolean(form.notes)}>
          <label htmlFor="planned-order-notes" className="mb-1.5 block text-sm font-medium text-slate-700">{ar?'ملاحظات (اختياري)':'Notes (optional)'}</label>
          <textarea id="planned-order-notes" className={inputClass} rows={2} maxLength={2000} value={form.notes} onChange={event=>change({notes:event.target.value})}/>
        </OptionalFields>
        <button type="submit" className={primaryClass} disabled={!valid||!form.documentDate}>{c(busy?'saving':'saveDraft')}</button>
      </fieldset>
    </form>
    {picker&&<RecordPicker {...{api,c,lang}} path={`${path}/suppliers?state=active`} title={c('chooseSupplier')}
      returnFocus={trigger.current} close={()=>setPicker(false)} onSelect={supplier=>{change({supplier});setPicker(false);}}/>}
  </section>;
}
