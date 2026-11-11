import { useRef, useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Modal, Pager, Select, Table, buttonClass, primaryClass, panelClass } from '../business-v2/UI';
function ChangeStatus({ row, kind, api, c, lang, close, done, returnFocus }) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const action = row.active ? kind === 'businesses' ? 'suspend' : 'disable' : 'reactivate';
  const hint = row.active ? kind === 'businesses' ? 'suspendHint' : 'disableHint' : kind === 'businesses' ? 'reactivateBusinessHint' : 'reactivateUserHint';
  async function save(event) { event.preventDefault(); setBusy(true); setError(''); try { await api(`/platform/${kind}/${row.id}/status`, { method: 'PATCH', body: { active: !row.active, revision: row.revision, reason: reason.trim() } }); done(true); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <Modal title={c(action)} description={c(hint)} {...{ busy, close, c, lang, returnFocus }}><p className="text-sm font-semibold text-slate-800 break-words">{row.name}{row.email && <span dir="ltr" className="block font-normal text-slate-500 break-all">{row.email}</span>}</p><form onSubmit={save} className="space-y-4"><Feedback error={error} c={c} retry={error === 'REVISION_CONFLICT' ? () => done(false) : undefined} /><Field id="platform-reason" label={c('reason')} placeholder={c('reasonPlaceholder')} hint={c('reasonHint')} value={reason} onChange={e => setReason(e.target.value)} minLength={5} maxLength={500} required disabled={busy || error === 'REVISION_CONFLICT'} /><div className="flex flex-wrap justify-end gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={close}>{c('cancel')}</button><button className={primaryClass} disabled={busy || reason.trim().length < 5 || error === 'REVISION_CONFLICT'}>{c(busy ? 'saving' : 'confirm')}</button></div></form></Modal>;
}
export function Records({ kind, api, c, lang }) {
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [status, setStatus] = useState('all'), [page, setPage] = useState(1), [editing, setEditing] = useState(null), [notice, setNotice] = useState('');
  const trigger = useRef(null), isBusiness = kind === 'businesses';
  const { data, error, reload } = useResource(api, `/platform/${kind}?${new URLSearchParams({ page: String(page), q: search, status })}`);
  return <section className="space-y-5"><h2 className="text-lg font-bold">{c(kind)}</h2>
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); setSearch(query.trim()); setPage(1); }}><div className="w-full sm:w-80"><Field id="platform-search" label={c('search')} placeholder={c(isBusiness ? 'businessSearch' : 'userSearch')} type="search" value={query} onChange={e => setQuery(e.target.value)} maxLength={100} /></div><Select id="platform-status" label={c('status')} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">{c('all')}</option><option value="active">{c('active')}</option><option value="inactive">{c(isBusiness ? 'suspended' : 'disabled')}</option></Select><button className={buttonClass}>{c('search')}</button></form>
    <Feedback error={error} notice={notice} c={c} retry={reload} />{!data && !error && <p role="status" className="text-sm text-slate-500">{c('loading')}</p>}
    {data && <><Table headers={isBusiness ? ['business','members','status','actions'] : ['memberName','email','role','verified','status','actions']} c={c} empty={!data.items.length}>{data.items.map(row => <tr key={row.id}>
      <td className="px-5 py-3 text-slate-800 font-semibold">{row.name}</td>{isBusiness ? <td className="px-5 py-3 text-slate-600">{row.memberCount}</td> : <><td className="px-5 py-3 text-slate-600"><span dir="ltr">{row.email}</span></td><td className="px-5 py-3 whitespace-nowrap text-slate-600">{c(row.platformRole)}</td><td className="px-5 py-3 text-slate-600">{c(row.verified ? 'yes' : 'no')}</td></>}
      <td className="px-5 py-3"><span className={`inline-block rounded-full px-2 py-1 text-xs font-semibold ${row.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{c(row.active ? 'active' : isBusiness ? 'suspended' : 'disabled')}</span></td>
      <td className="px-5 py-3">{row.platformRole === 'SUPER_ADMIN' ? <span className="text-xs text-slate-500 whitespace-nowrap">{c('protected')}</span> : <button className={`${buttonClass} whitespace-nowrap`} onClick={event => { trigger.current = event.currentTarget; setNotice(''); setEditing(row); }}>{c(row.active ? isBusiness ? 'suspend' : 'disable' : 'reactivate')}</button>}</td>
    </tr>)}</Table><Pager data={data} setPage={setPage} c={c} /></>}
    {editing && <ChangeStatus row={editing} {...{ kind, api, c, lang }} returnFocus={trigger.current} close={() => setEditing(null)} done={saved => { setEditing(null); reload(); setNotice(saved ? 'saved' : ''); }} />}
  </section>;
}
export function Overview({ api, c }) {
  const { data, error, reload } = useResource(api, '/platform/overview');
  return <section className="space-y-5"><h2 className="text-lg font-bold">{c('overview')}</h2><Feedback error={error} c={c} retry={reload} />{!data && !error && <p role="status">{c('loading')}</p>}{data && <dl className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">{[['businesses','businesses'],['suspendedBusinesses','suspendedBusinesses'],['users','customerAccounts'],['disabledUsers','disabledUsers']].map(([key,label]) => <div key={key} className={panelClass}><dt className="text-sm text-slate-500">{c(label)}</dt><dd className="text-2xl font-bold mt-2 text-slate-900 tabular">{data[key]}</dd></div>)}</dl>}</section>;
}
export function Audit({ api, c, lang }) {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useResource(api, `/platform/audit?page=${page}`);
  return <section className="space-y-5"><h2 className="text-lg font-bold">{c('audit')}</h2><Feedback error={error} c={c} retry={reload} />{!data && !error && <p role="status">{c('loading')}</p>}{data && <><Table headers={['activity','target','reason','actor','date']} c={c} empty={!data.items.length}>{data.items.map(row => <tr key={row.id}><td className="px-5 py-3 text-slate-800">{c(row.action)}</td><td className="px-5 py-3 text-slate-600">{row.targetName || row.targetId}</td><td className="px-5 py-3 text-slate-600 min-w-48 max-w-md break-words">{row.reason}</td><td className="px-5 py-3 text-slate-600">{row.actorName || row.actorId}</td><td className="px-5 py-3 text-slate-600 whitespace-nowrap">{new Date(row.createdAt).toLocaleString(lang === 'ar' ? 'ar' : 'en')}</td></tr>)}</Table><Pager data={data} setPage={setPage} c={c} /></>}</section>;
}
