import { useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { Feedback, Select, buttonClass, primaryClass } from '../business-v2/UI';
export default function PlanForm({api,c,done,cancel,setBusy,busy,plan}) {
  const [form,setForm] = useState(plan?{code:plan.code,name:plan.name,nameAr:plan.nameAr,price:plan.priceMinor===null?'':(plan.priceMinor/100).toFixed(2),currency:plan.currency,interval:plan.interval,trialDays:plan.trialDays,maxMembers:plan.maxMembers,maxWarehouses:plan.maxWarehouses,maxShops:plan.maxShops}:{code:'',name:'',nameAr:'',price:'',currency:'USD',interval:'MONTH',trialDays:14,maxMembers:10,maxWarehouses:2,maxShops:3}), [error,setError] = useState('');
  const set = key => e=>setForm(f=>({...f,[key]:e.target.value}));
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); try {
    const {price,...values}=form;
    // Money is converted from validated decimal text without floating-point multiplication.
    const [whole,fraction=''] = price.split('.'); const priceMinor=price ? Number(whole)*100+Number(fraction.padEnd(2,'0')) : null;
    await api(plan?`/billing/plans/${plan.id}/draft`:'/billing/plans',{method:plan?'PUT':'POST',body:{...(plan?{revision:plan.revision}:{}),...values,priceMinor,...Object.fromEntries(['trialDays','maxMembers','maxWarehouses','maxShops'].map(k=>[k,Number(form[k])]))}}); done();
  } catch(e) {setError(e.message);} finally {setBusy(false);} }
  return <form onSubmit={submit} className="space-y-4"><Feedback error={error} c={c}/><fieldset disabled={busy} className="grid sm:grid-cols-2 gap-4">
    <Field id="plan-code" label={c('code')} placeholder={c('codePlaceholder')} dir="ltr" value={form.code} onChange={set('code')} required pattern={'[a-z0-9][a-z0-9\\-]{2,59}'} maxLength={60}/>
    <Field id="plan-name" label={c('nameEn')} placeholder={c('nameEnPlaceholder')} dir="ltr" value={form.name} onChange={set('name')} required minLength={2} maxLength={80}/>
    <Field id="plan-name-ar" label={c('nameAr')} placeholder={c('nameArPlaceholder')} dir="rtl" value={form.nameAr} onChange={set('nameAr')} required minLength={2} maxLength={80}/>
    <Field id="plan-price" label={c('price')} placeholder={c('pricePlaceholder')} hint={c('priceHint')} dir="ltr" inputMode="decimal" pattern="[0-9]{1,7}(\.[0-9]{1,2})?" value={form.price} onChange={set('price')}/>
    <Select id="plan-currency" label={c('currency')} value={form.currency} onChange={set('currency')}>{['USD','EUR','GBP','AED','SAR'].map(v=><option key={v}>{v}</option>)}</Select>
    <Select id="plan-interval" label={c('interval')} value={form.interval} onChange={set('interval')}>{['MONTH','YEAR'].map(v=><option key={v} value={v}>{c(v)}</option>)}</Select>
    {['trialDays','maxMembers','maxWarehouses','maxShops'].map(k=><Field key={k} id={`plan-${k}`} label={c(k)} placeholder={k==='maxMembers'?'10':k==='trialDays'?'14':k==='maxWarehouses'?'2':'3'} type="number" min={k==='maxMembers'?1:0} max={k==='trialDays'?60:k==='maxMembers'?100000:10000} step="1" required value={form[k]} onChange={set(k)}/>)}
  </fieldset><div className="flex justify-end gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={cancel}>{c('cancel')}</button><button className={primaryClass} disabled={busy}>{c(busy?'saving':'save')}</button></div></form>;
}
