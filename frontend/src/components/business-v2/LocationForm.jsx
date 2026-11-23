import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { Feedback, Modal, Select, buttonClass, primaryClass } from './UI';


export default function LocationForm({ location, path, api, c, lang, close, done, returnFocus, initialKind }) {
  const [form,setForm] = useState(location || {name:'',kind:initialKind||'',address:''});
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
 const draft=useLocalDraft(`location:${location?.id||initialKind||'new'}:${location?.revision||0}`,{form},saved=>{setForm({...saved.form,...(!location&&initialKind?{kind:initialKind}:{})});});
  const set = key => e => setForm(f => ({...f,[key]:e.target.value}));
  async function save(e) {
    e.preventDefault();setBusy(true);setError('');
    try { await api(location ? `${path}/${location.id}` : path,{method:location?'PATCH':'POST',body:location?{revision:location.revision,name:form.name,address:form.address}:{name:form.name,kind:form.kind,address:form.address}});draft.clear();done(); }
    catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  return <Modal title={c(location?'editLocation':'addLocation')} description={c('locationFormHint')} {...{close,returnFocus,lang,c,busy}}>
    <form className="space-y-4" onSubmit={save}><LocalDraftNotice {...{draft,lang,busy}}/><Feedback error={error} c={c} retry={error==='REVISION_CONFLICT'?()=>done(false):undefined}/>
      <fieldset disabled={busy || error==='REVISION_CONFLICT'} className="space-y-4">
        <Field id="location-name" label={lang === 'ar' ? 'اسم المتجر' : 'Shop name'} placeholder={c('locationNamePlaceholder')} value={form.name} onChange={set('name')} minLength={2} maxLength={120} required />
        {!location && !initialKind && <Select id="location-kind" label={c('locationKind')} required value={form.kind} onChange={set('kind')}><option value="" disabled>{lang === 'ar' ? 'اختر نوع الموقع' : 'Choose a location type'}</option><option value="WAREHOUSE">{c('WAREHOUSE')}</option><option value="SHOP">{c('SHOP')}</option></Select>}
        <Field id="location-address" label={c('locationAddress')} placeholder={c('locationAddressPlaceholder')} value={form.address} onChange={set('address')} maxLength={500} />
      </fieldset>
      <div className="flex flex-wrap justify-end rtl:justify-start gap-2"><button className={primaryClass} disabled={busy || error==='REVISION_CONFLICT'}>{c(busy?'saving':'save')}</button><button type="button" className={buttonClass} disabled={busy} onClick={close}>{c('cancel')}</button></div>
    </form>
  </Modal>;
}
