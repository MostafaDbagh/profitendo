import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import {LoadingState} from '../page-layout/PageResults';
import Disclosure from './Disclosure';
import PermissionDetails, {customizeLabel,permissionGroupLabels} from './PermissionDetails';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Field } from '../auth-v2/Fields';
import { useResource } from './useBusinessApi';
import { Feedback, Modal, Select, buttonClass, primaryClass } from './UI';

function AddRole({ data, api, path, c, lang, close, done, returnFocus }) {
  const [name, setName] = useState(''), [base, setBase] = useState(''), [permissions, setPermissions] = useState({ 'business.view': true });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
 const draft=useLocalDraft('new-role',{name,base,permissions},saved=>{setName(saved.name);setBase(saved.base);setPermissions(saved.permissions);});
  const allowed = data.grantableKeys;
  const groups = [...new Set(allowed.map(key => key.split('.')[0]))];

  function startFrom(value) {
    setBase(value);
    const source = data.roles.find(role => role.role === value)?.permissions || {};
    setPermissions(Object.fromEntries(allowed.map(key => [key, key === 'business.view' || Boolean(source[key])])));
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api(path, { method:'POST', body:{ name:name.trim(), permissions } }); draft.clear();done(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title={c('addRole')} description={lang==='ar'?'ابدأ بدور موجود، ثم خصّصه عند الحاجة.':'Start from an existing role, then customize if needed.'} {...{ close, busy, c, lang, returnFocus }}>
    <form onSubmit={save} className="space-y-5">
      <LocalDraftNotice {...{draft,lang,busy}}/><Feedback error={error} c={c} />
      <fieldset disabled={busy} className="space-y-4">
        <Select id="role-base" label={c('roleStartFrom')} value={base} onChange={event => startFrom(event.target.value)}>
          <option value="">{c('roleMinimal')}</option>
          {data.roles.filter(role => role.role !== 'OWNER').map(role => <option key={role.role} value={role.role}>{role.name || c(role.role)}</option>)}
        </Select>
        <Field id="role-name" label={c('roleName')} placeholder={c('roleNamePlaceholder')} required minLength={2} maxLength={80} value={name} onChange={event => setName(event.target.value)} />
        <p className="text-sm text-slate-600">{lang==='ar'?'الصلاحيات المسموحة':'Allowed permissions'}: {allowed.filter(key=>permissions[key]).length}</p>
        <Disclosure title={customizeLabel(lang)}><fieldset className="space-y-3"><legend className="sr-only">{c('rolePermissions')}</legend>
          {groups.map(group => <Disclosure key={group} title={c(permissionGroupLabels[group] || group)}>
            {allowed.filter(key => key.startsWith(`${group}.`)).map(key => <label key={key} className="flex items-start gap-3 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-500" checked={Boolean(permissions[key])} disabled={key === 'business.view'} onChange={event => setPermissions(current => ({ ...current, [key]:event.target.checked }))} />
              <span>{c(key)}{key === 'business.view' && <span className="block text-xs text-slate-500">{c('roleWorkspaceRequired')}</span>}</span>
            </label>)}
          </Disclosure>)}
        </fieldset></Disclosure>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2 rtl:flex-row-reverse"><button type="button" className={buttonClass} disabled={busy} onClick={close}>{c('cancel')}</button><button className={primaryClass} disabled={busy}>{c(busy ? 'saving' : 'addRole')}</button></div>
    </form>
  </Modal>;
}
export default function Roles({ context, api, c, lang }) {
  const path = `/businesses/${context.business.id}/roles`;
  const { data, error, reload } = useResource(api, path);
  const trigger = useRef(null);
  const [adding, setAdding] = useState(false), [notice, setNotice] = useState('');
  return <PageLayout>
    <PageHeader title={c('roles')} accessory={data?.canCreate && <button ref={trigger} className={primaryClass} onClick={() => { setNotice(''); setAdding(true); }}><Plus className="w-4 h-4" aria-hidden="true" />{c('addRole')}</button>}/>
    <Feedback error={error} notice={notice} c={c} retry={reload} />
    {!data && !error && <LoadingState>{c('loading')}</LoadingState>}
    {data && <ul className="space-y-3">{data.roles.map(role => <li key={role.role} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-800">{role.name || c(role.role)}</h3>{role.custom&&<span className="text-xs text-slate-500">{c('customRole')}</span>}</div>
      <PermissionDetails permissions={role.permissions} keys={Object.keys(data.permissions)} {...{c,lang}}/>
    </li>)}</ul>}

    {adding && <AddRole {...{ data, api, path, c, lang }} returnFocus={trigger.current} close={() => setAdding(false)} done={() => { setAdding(false); setNotice('roleCreated'); reload(); }} />}
  </PageLayout>;
}
