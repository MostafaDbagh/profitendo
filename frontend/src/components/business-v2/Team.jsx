import { useRef, useState } from 'react';
import { useResource } from './useBusinessApi';
import { Feedback, Modal, Pager, Select, Table, buttonClass, primaryClass } from './UI';
import { staffRoles } from './copy';
function EditMember({ member, api, path, c, lang, close, done, returnFocus, permissionKeys, actorPermissions, isOwner, roleDefaults }) {
  const [role, setRole] = useState(member.role), [active, setActive] = useState(member.active), [overrides, setOverrides] = useState(member.permissionOverrides || {});
  const groupLabels={business:'settings',team:'team',roles:'roles',audit:'audit',locations:'locations',catalogue:'catalogue',suppliers:'suppliers',purchasing:'purchases',receiving:'purchases',sales:'sales',transfers:'transfers',inventory:'inventory',returns:'returns',counts:'counts',payments:'payments',cash:'payments',reports:'reports'};
  const groups=[...new Set(permissionKeys.map(key=>key.split('.')[0]))];
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api(`${path}/${member.id}`, { method: 'PATCH', body: { revision: member.revision, role, active, permissionOverrides: Object.fromEntries(Object.entries(overrides).filter(([key])=>isOwner||key!=='team.manage')) } }); done(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title={`${c('edit')} · ${member.name}`} description={c('accessHint')} {...{ close, busy, c, lang, returnFocus }}>
    <form onSubmit={save} className="space-y-5">
      <Feedback error={error} c={c} retry={error === 'REVISION_CONFLICT' ? () => done(false) : undefined} />
      <fieldset disabled={busy || error === 'REVISION_CONFLICT'} className="space-y-4">
        <Select id="member-role" label={c('role')} value={role} onChange={e => { setRole(e.target.value); setOverrides({}); }}>{staffRoles.map(r => <option key={r} value={r}>{c(r)}</option>)}</Select>
        <div><label className="flex items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={active} disabled={member.accountDisabled} onChange={e => setActive(e.target.checked)} />{c('active')}</label><p className="text-xs text-slate-500 mt-1.5">{c(member.accountDisabled ? 'accountDisabled' : 'activeHint')}</p></div>
        <fieldset className="space-y-3"><legend className="text-sm font-semibold text-slate-900 mb-3">{c('custom')}</legend>{groups.map(group=><details key={group} open className="rounded-xl border border-slate-200 p-3 space-y-3"><summary className="cursor-pointer font-semibold text-sm focus-visible:ring-2 focus-visible:ring-emerald-500">{c(groupLabels[group]||group)}</summary>{permissionKeys.filter(key=>key.startsWith(group+'.')).map(key => <Select key={key} id={`permission-${key}`} label={c(key)} value={typeof overrides[key] === 'boolean' ? String(overrides[key]) : 'default'} onChange={e => setOverrides(current => { const next = { ...current }; if (e.target.value === 'default') delete next[key]; else next[key] = e.target.value === 'true'; return next; })}><option value="default">{c('default')} · {c(roleDefaults.find(r=>r.role===role)?.permissions[key]?'allow':'deny')}</option><option value="true" disabled={!isOwner&&!actorPermissions[key]}>{c('allow')}</option><option value="false">{c('deny')}</option></Select>)}</details>)}</fieldset>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={close}>{c('cancel')}</button><button className={primaryClass} disabled={busy || error === 'REVISION_CONFLICT'}>{c(busy ? 'saving' : 'save')}</button></div>
    </form>
  </Modal>;
}
export default function Team({ context, api, c, lang }) {
  const trigger = useRef(null);
  const [page, setPage] = useState(1), [editing, setEditing] = useState(null), [notice, setNotice] = useState('');
  const path = `/businesses/${context.business.id}/members`;
  const { data, error, reload } = useResource(api, `${path}?page=${page}`);
  return <section className="space-y-4"><h2 className="text-lg font-bold text-slate-900">{c('team')}</h2><Feedback error={error} notice={notice} c={c} retry={reload} />
    {!data && !error && <p role="status" className="text-sm text-slate-500">{c('loading')}</p>}
    {data && <><Table headers={['memberName','email','role','status', ...(context.permissions['team.manage'] ? ['actions'] : [])]} empty={!data.items.length} c={c}>{data.items.map(m => <tr key={m.id}>
      <td className="px-5 py-3 font-semibold text-slate-800">{m.name}</td><td className="px-5 py-3 text-slate-600"><span dir="ltr">{m.email}</span></td><td className="px-5 py-3"><span className="inline-block px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold whitespace-nowrap">{c(m.role)}</span></td><td className="px-5 py-3 text-slate-600 whitespace-nowrap">{c(m.accountDisabled ? 'accountDisabled' : m.active ? 'active' : 'inactive')}</td>
      {context.permissions['team.manage'] && <td className="px-5 py-3">{m.canEdit && <button className={`${buttonClass} whitespace-nowrap`} onClick={event => { trigger.current = event.currentTarget; setNotice(''); setEditing(m); }}>{c('edit')}</button>}</td>}
    </tr>)}</Table><Pager data={data} setPage={setPage} c={c} /></>}
    {editing && <EditMember returnFocus={trigger.current} member={editing} permissionKeys={data.permissionKeys||[]} roleDefaults={data.roleDefaults||[]} actorPermissions={context.permissions} isOwner={context.role==='OWNER'} {...{ api, path, c, lang }} close={() => setEditing(null)} done={(saved = true) => { setEditing(null); reload(); setNotice(saved ? 'saved' : ''); }} />}
  </section>;
}
