import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Field } from '../auth-v2/Fields';
import { useResource } from './useBusinessApi';
import { Feedback, Modal, Select, Table, buttonClass, primaryClass } from './UI';

function AddRole({ data, api, path, c, lang, close, done, returnFocus }) {
  const [name, setName] = useState(''), [base, setBase] = useState(''), [permissions, setPermissions] = useState({ 'business.view': true });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const allowed = data.grantableKeys;
  const groups = [...new Set(allowed.map(key => key.split('.')[0]))];
  const labels = { business:'settings', team:'team', roles:'roles', audit:'audit', locations:'locations', catalogue:'catalogue', suppliers:'suppliers', purchasing:'purchases', receiving:'purchases', sales:'sales', transfers:'transfers', inventory:'inventory', returns:'returns', counts:'counts', payments:'payments', cash:'payments', reports:'reports' };
  function startFrom(value) {
    setBase(value);
    const source = data.roles.find(role => role.role === value)?.permissions || {};
    setPermissions(Object.fromEntries(allowed.map(key => [key, key === 'business.view' || Boolean(source[key])])));
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api(path, { method:'POST', body:{ name:name.trim(), permissions } }); done(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title={c('addRole')} description={c('roleCreateHint')} {...{ close, busy, c, lang, returnFocus }}>
    <form onSubmit={save} className="space-y-5">
      <Feedback error={error} c={c} />
      <fieldset disabled={busy} className="space-y-4">
        <Field id="role-name" label={c('roleName')} placeholder={c('roleNamePlaceholder')} required minLength={2} maxLength={80} value={name} onChange={event => setName(event.target.value)} />
        <Select id="role-base" label={c('roleStartFrom')} value={base} onChange={event => startFrom(event.target.value)}>
          <option value="">{c('roleMinimal')}</option>
          {data.roles.filter(role => role.role !== 'OWNER').map(role => <option key={role.role} value={role.role}>{role.name || c(role.role)}</option>)}
        </Select>
        <fieldset className="space-y-3"><legend className="text-sm font-semibold text-slate-900 mb-2">{c('rolePermissions')}</legend>
          {groups.map(group => <div key={group} className="rounded-xl border border-slate-200 p-3 space-y-3">
            <h3 className="font-semibold text-sm text-slate-800">{c(labels[group] || group)}</h3>
            {allowed.filter(key => key.startsWith(`${group}.`)).map(key => <label key={key} className="flex items-start gap-3 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-500" checked={Boolean(permissions[key])} disabled={key === 'business.view'} onChange={event => setPermissions(current => ({ ...current, [key]:event.target.checked }))} />
              <span>{c(key)}{key === 'business.view' && <span className="block text-xs text-slate-500">{c('roleWorkspaceRequired')}</span>}</span>
            </label>)}
          </div>)}
        </fieldset>
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
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold text-slate-900">{c('roles')}</h2>
      {data?.canCreate && <button ref={trigger} className={primaryClass} onClick={() => { setNotice(''); setAdding(true); }}><Plus className="w-4 h-4" aria-hidden="true" />{c('addRole')}</button>}
    </div>
    <p className="text-sm text-slate-500">{c('rolesHint')}</p>
    <Feedback error={error} notice={notice} c={c} retry={reload} />
    {!data && !error && <p role="status">{c('loading')}</p>}
    {data && <Table headers={['role', ...Object.keys(data.permissions)]} c={c}>{data.roles.map(role => <tr key={role.role}>
      <td className="px-5 py-3 font-semibold text-slate-800 whitespace-nowrap">{role.name || c(role.role)}{role.custom && <span className="block text-xs font-normal text-slate-500">{c('customRole')}</span>}</td>
      {Object.keys(data.permissions).map(key => <td key={key} className={`px-5 py-3 ${role.permissions[key] ? 'text-emerald-700' : 'text-slate-500'}`}>{c(role.permissions[key] ? 'yes' : 'no')}</td>)}
    </tr>)}</Table>}
    {adding && <AddRole {...{ data, api, path, c, lang }} returnFocus={trigger.current} close={() => setAdding(false)} done={() => { setAdding(false); setNotice('roleCreated'); reload(); }} />}
  </section>;
}
