import { useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { Feedback, Modal, Select, buttonClass, primaryClass } from './UI';
export default function LocationForm({ location, path, api, c, lang, close, done, returnFocus }) {
  const [form,setForm] = useState(location || {name:'',code:'',kind:'WAREHOUSE',address:''});
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const set = key => e => setForm(f => ({...f,[key]:e.target.value}));
  async function save(e) {
    e.preventDefault();setBusy(true);setError('');
    try { await api(location ? `${path}/${location.id}` : path,{method:location?'PATCH':'POST',body:location?{revision:location.revision,name:form.name,address:form.address}:form});done(); }
    catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  return <Modal title={c(location?'editLocation':'addLocation')} description={c('locationFormHint')} {...{close,returnFocus,lang,c,busy}}>
    <form className="space-y-4" onSubmit={save}><Feedback error={error} c={c} retry={error==='REVISION_CONFLICT'?()=>done(false):undefined}/>
      <fieldset disabled={busy || error==='REVISION_CONFLICT'} className="space-y-4">
        <Field id="location-name" label={c('locationName')} placeholder={c('locationNamePlaceholder')} value={form.name} onChange={set('name')} minLength={2} maxLength={120} required />
        {!location && <><Field id="location-code" label={c('locationCode')} hint={c('locationCodeHint')} placeholder={c('locationCodePlaceholder')} dir="ltr" value={form.code} onChange={set('code')} minLength={2} maxLength={30} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,29}" required /><Select id="location-kind" label={c('locationKind')} value={form.kind} onChange={set('kind')}><option value="WAREHOUSE">{c('WAREHOUSE')}</option><option value="SHOP">{c('SHOP')}</option></Select></>}
        <Field id="location-address" label={c('locationAddress')} placeholder={c('locationAddressPlaceholder')} value={form.address} onChange={set('address')} maxLength={500} />
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={close}>{c('cancel')}</button><button className={primaryClass} disabled={busy || error==='REVISION_CONFLICT'}>{c(busy?'saving':'save')}</button></div>
    </form>
  </Modal>;
}
