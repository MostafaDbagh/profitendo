import { useRef, useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { staffRoles } from './copy';
import { useResource } from './useBusinessApi';
import { Feedback, Modal, Pager, Select, Table, buttonClass, primaryClass, panelClass } from './UI';
export function Roles({ context, api, c }) {
  const { data, error, reload } = useResource(api, `/businesses/${context.business.id}/roles`);
  return <section className="space-y-4"><h2 className="text-lg font-bold text-slate-900">{c('defaultAccess')}</h2><Feedback error={error} c={c} retry={reload} />{!data && !error && <p role="status">{c('loading')}</p>}{data && <Table headers={['role', ...Object.keys(data.permissions)]} c={c}>{data.roles.map(r => <tr key={r.role}><td className="px-5 py-3 font-semibold text-slate-800 whitespace-nowrap">{c(r.role)}</td>{Object.keys(data.permissions).map(p => <td key={p} className={`px-5 py-3 ${r.permissions[p] ? 'text-emerald-700' : 'text-slate-500'}`}>{c(r.permissions[p] ? 'yes' : 'no')}</td>)}</tr>)}</Table>}</section>;
}
export function Invitations({ context, api, c, lang }) {
  const trigger = useRef(null);
  const [page, setPage] = useState(1), [email, setEmail] = useState(''), [role, setRole] = useState('CASHIER'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revoking, setRevoking] = useState(null);
  const path = `/businesses/${context.business.id}/invitations`;
  const resource = useResource(api, `${path}?page=${page}`);
  async function send(event) { event.preventDefault(); setBusy(true); setError(''); setNotice(''); try { await api(path, { method: 'POST', body: { email, role } }); setEmail(''); setNotice('inviteSent'); setPage(1); resource.reload(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function revoke() { setBusy(true); setError(''); setNotice(''); try { await api(`${path}/${revoking.id}/revoke`, { method: 'POST', body: {} }); setRevoking(null); setNotice('saved'); resource.reload(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <section className="space-y-5"><form onSubmit={send} className={`${panelClass} space-y-4`}><h2 className="text-lg font-bold text-slate-900">{c('sendInvite')}</h2><p className="text-sm text-slate-500">{c('inviteHint')}</p><fieldset disabled={busy} className="grid sm:grid-cols-2 gap-4"><Field id="team-email" label={c('inviteEmail')} placeholder={c('inviteEmailPlaceholder')} type="email" dir="ltr" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} /><Select id="invite-role" label={c('role')} value={role} onChange={e => setRole(e.target.value)}>{staffRoles.map(r => <option key={r} value={r}>{c(r)}</option>)}</Select></fieldset><button className={primaryClass} disabled={busy}>{c(busy ? 'saving' : 'sendInvite')}</button></form>
    {!revoking && <Feedback error={error || resource.error} notice={notice} c={c} retry={resource.error ? resource.reload : undefined} />}
    {!resource.data && !resource.error && <p role="status">{c('loading')}</p>}
    {resource.data && <><Table headers={['email','role','status','actions']} empty={!resource.data.items.length} c={c}>{resource.data.items.map(i => <tr key={i.id}><td className="px-5 py-3 text-slate-700"><span dir="ltr">{i.email}</span></td><td className="px-5 py-3 whitespace-nowrap">{c(i.role)}</td><td className="px-5 py-3">{c(i.status)}</td><td className="px-5 py-3">{i.status === 'pending' && <button className={`${buttonClass} whitespace-nowrap`} disabled={busy} onClick={event => { trigger.current = event.currentTarget; setError(''); setRevoking(i); }}>{c('revokeInvite')}</button>}</td></tr>)}</Table><Pager data={resource.data} setPage={setPage} c={c} /></>}
    {revoking && <Modal returnFocus={trigger.current} title={c('revokeQuestion')} description={c('revokeHint')} {...{ busy, c, lang }} close={() => { setRevoking(null); setError(''); }}><p dir="ltr" className="text-sm break-all">{revoking.email}</p><Feedback error={error} c={c} /><div className="flex flex-wrap justify-end gap-2"><button className={buttonClass} disabled={busy} onClick={() => setRevoking(null)}>{c('cancel')}</button><button className={primaryClass} disabled={busy} onClick={revoke}>{c('revokeInvite')}</button></div></Modal>}
  </section>;
}
export function Audit({ context, api, c, lang }) {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useResource(api, `/businesses/${context.business.id}/audit?page=${page}`);
  return <section className="space-y-4"><h2 className="text-lg font-bold text-slate-900">{c('audit')}</h2><Feedback error={error} c={c} retry={reload} />{!data && !error && <p role="status">{c('loading')}</p>}{data && <><Table headers={['activity','actor','date']} empty={!data.items.length} c={c}>{data.items.map(a => <tr key={a.id}><td className="px-5 py-3 text-slate-800">{c(a.action, 'activityFallback')}</td><td className="px-5 py-3 text-slate-600">{a.actorName || c('system')}</td><td className="px-5 py-3 text-slate-600 whitespace-nowrap">{new Date(a.createdAt).toLocaleString(lang === 'ar' ? 'ar' : 'en', { timeZone: context.business.timezone })}</td></tr>)}</Table><Pager data={data} setPage={setPage} c={c} /></>}</section>;
}
