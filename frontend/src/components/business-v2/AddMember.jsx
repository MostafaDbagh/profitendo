import { useState } from 'react';
import { Field } from '../auth-v2/Fields';
import { Feedback, Modal, Select, buttonClass, primaryClass } from './UI';

export default function AddMember({ context, roles, api, c, lang, close, done, returnFocus }) {
  const available = roles.filter(role => role.role !== 'OWNER' && (context.role === 'OWNER' || (!role.permissions['team.manage'] && Object.entries(role.permissions).every(([key, value]) => !value || context.permissions[key]))));
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(''), [role, setRole] = useState(available.find(r => r.role === 'CASHIER')?.role || available[0]?.role || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const selected = available.find(item => item.role === role);
    if (!selected) { setError('VALIDATION_ERROR'); setBusy(false); return; }
    try {
      await api(`/businesses/${context.business.id}/invitations`, { method:'POST', body:{ ...(password ? { password } : {}), name:name.trim(), email:email.trim(), ...(selected.custom ? { customRoleId:role } : { role }) } });
      done();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title={c('addTeamMember')} description={c('addTeamMemberHint')} {...{ close, busy, c, lang, returnFocus }}>
    <form onSubmit={submit} className="space-y-5">
      <Feedback error={error} c={c} />
      <fieldset disabled={busy} className="space-y-4">
        <Field id="add-member-name" label={c('memberName')} placeholder={c('teamMemberNamePlaceholder')} autoComplete="name" minLength={2} maxLength={100} required value={name} onChange={event => setName(event.target.value)} />
        <Field id="add-member-email" label={c('inviteEmail')} placeholder={c('inviteEmailPlaceholder')} type="email" dir="ltr" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} />
        <Field id="add-member-password" label={c('invitePassword')} hint={c('invitePasswordHint')} placeholder={c('invitePasswordPlaceholder')} type="password" autoComplete="new-password" dir="ltr" minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
        <Select id="add-member-role" label={c('role')} required value={role} onChange={event => setRole(event.target.value)}>
          {!available.length && <option value="">{c('noAssignableRole')}</option>}
          {available.map(item => <option key={item.role} value={item.role}>{item.name || c(item.role)}</option>)}
        </Select>
        {!available.length && <p className="text-sm text-slate-500">{c('noAssignableRoleHint')}</p>}
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2 rtl:flex-row-reverse"><button type="button" className={buttonClass} disabled={busy} onClick={close}>{c('cancel')}</button><button className={primaryClass} disabled={busy || !role}>{c(busy ? 'saving' : 'sendInvite')}</button></div>
    </form>
  </Modal>;
}
