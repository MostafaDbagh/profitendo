import CopyableCode from '../CopyableCode';
import {PageHeader, PageLayout} from '../page-layout/PageLayout';
import { Monitor, UserRound } from 'lucide-react';
import MfaSettings from './MfaSettings';
import { OwnerPinSettings } from './OwnerPin';
import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {authCopy} from '../auth-v2/copy';
import {Field} from '../auth-v2/Fields';
import {useResource} from './useBusinessApi';
import {Feedback,buttonClass,primaryClass,panelClass} from './UI';
export default function Security({api,lang,context,c:businessCopy,onPinStatus}){
 const c=key=>authCopy[lang]?.[key]||authCopy.en[key]||authCopy[lang].failed,navigate=useNavigate();
 const account=useResource(api,'/auth/me'),sessions=useResource(api,'/auth/sessions');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[form,setForm]=useState({currentPassword:'',password:'',confirmation:''});
 const set=key=>e=>setForm(f=>({...f,[key]:e.target.value}));
 async function run(work){setBusy(true);setError('');try{await work();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function leave(path){await api(path,{method:'POST',body:{}});navigate('/auth-v2',{replace:true});}
 return <PageLayout className="w-full max-w-2xl" data-testid="account-security"><PageHeader title={c('accountTitle')}/><Feedback error={error||account.error||sessions.error} c={c} retry={()=>{account.reload();sessions.reload();}}/>{account.data&&<div className={`${panelClass} flex items-start gap-3 text-start`}>
  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
   <UserRound className="h-5 w-5" aria-hidden="true" />
  </span>
  <div className="min-w-0">
   <p className="break-words font-semibold"><bdi>{account.data.user.name}</bdi></p>
   <p className="break-all text-sm text-slate-500"><bdi><CopyableCode kind="email">{account.data.user.email}</CopyableCode></bdi></p>
  </div>
 </div>}
 {<MfaSettings {...{api,lang,c}} account={account.data} onChanged={()=>{account.reload();sessions.reload();}}/>}
 {context?.role==='OWNER'&&context.permissions['business.edit']&&
  <OwnerPinSettings {...{context,api,lang,onPinStatus}} c={businessCopy} />}
 <section className={`${panelClass} space-y-3`} aria-labelledby="security-sessions">
  <h3 id="security-sessions" className="flex items-center gap-2 font-bold">
   <Monitor className="h-5 w-5 text-emerald-700" aria-hidden="true" />{c('sessions')}
  </h3>
  {!sessions.data&&!sessions.error&&<p role="status">{c('checking')}</p>}
  <ul className="divide-y divide-slate-100">{sessions.data?.map(s=><li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-sm last:pb-0">
   <span className={s.current?'rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800':'text-slate-600'}>
    {s.current?c('thisSession'):<bdi>{new Date(s.createdAt).toLocaleString(lang)}</bdi>}
   </span>
   <button type="button" disabled={busy} className={buttonClass} onClick={()=>run(async()=>{
    await api('/auth/sessions/revoke',{method:'POST',body:{sessionId:s.id}});
    if(s.current)navigate('/auth-v2',{replace:true});
    else sessions.reload();
   })}>{c('revoke')}</button>
  </li>)}</ul>
 </section>
 <form className={`${panelClass} space-y-4 max-w-2xl`} onSubmit={e=>{e.preventDefault();run(async()=>{if(form.password!==form.confirmation)throw new Error('PASSWORD_MISMATCH');await api('/auth/password',{method:'POST',body:{currentPassword:form.currentPassword,password:form.password}});navigate('/auth-v2',{replace:true});});}}><h3 className="font-bold">{c('changePassword')}</h3><Field id="security-current" label={c('currentPassword')} placeholder={c('currentPasswordPlaceholder')} type="password" autoComplete="current-password" required maxLength={128} value={form.currentPassword} onChange={set('currentPassword')} disabled={busy}/><Field id="security-new" label={c('newPassword')} placeholder={c('newPasswordPlaceholder')} hint={c('passwordHint')} type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={form.password} onChange={set('password')} disabled={busy}/><Field id="security-confirm" label={c('confirmPassword')} placeholder={c('confirmPasswordPlaceholder')} type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={form.confirmation} onChange={set('confirmation')} disabled={busy}/><button className={primaryClass} disabled={busy}>{c('changePassword')}</button></form>
 <div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={busy} onClick={()=>run(()=>leave('/auth/lock'))}>{c('lock')}</button><button className={buttonClass} disabled={busy} onClick={()=>run(()=>leave('/auth/logout'))}>{c('logout')}</button><button className={buttonClass} disabled={busy} onClick={()=>run(()=>leave('/auth/sessions/revoke'))}>{c('revokeAll')}</button></div></PageLayout>;
}
