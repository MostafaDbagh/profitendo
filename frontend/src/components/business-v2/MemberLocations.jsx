import { useState } from 'react';
import { useResource } from './useBusinessApi';
import { Feedback, Pager, Modal, buttonClass } from './UI';
export function LocationChoices({api,businessId,selected,onChange,c}) {
 const [page,setPage]=useState(1);
 const {data,error,reload}=useResource(api,`/businesses/${businessId}/locations?state=active&page=${page}`);
 return <fieldset className="space-y-3"><legend className="font-semibold text-sm mb-2">{c('memberLocations')}</legend><p className="text-sm text-slate-500">{c('memberLocationsHint')}</p><Feedback error={error} c={c} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}{data?.items.map(l=><label key={l.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm"><input type="checkbox" className="accent-emerald-600 h-4 w-4" checked={selected.includes(l.id)} onChange={e=>onChange(l,e.target.checked)}/><span>{l.name} <span className="text-slate-500">· {c(l.kind)} · <bdi>{l.code}</bdi></span></span></label>)}{data&&!data.items.length&&<p>{c('noMemberLocations')}</p>}{data&&<Pager data={data} setPage={setPage} c={c}/>}</fieldset>;
}
export default function MemberLocations({member,context,api,c,lang,close,returnFocus}){
 const [selected,setSelected]=useState(member.locations.map(l=>l.id)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function change(location,assigned){setBusy(true);setError('');try{await api(`/businesses/${context.business.id}/locations/${location.id}/assignments`,{method:'PUT',body:{revision:location.revision,membershipId:member.id,assigned}});location.revision++;setSelected(old=>assigned?[...old,location.id]:old.filter(id=>id!==location.id));}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <Modal title={`${c('memberLocations')} · ${member.name}`} description={c('locationChangesImmediate')} {...{c,lang,close,busy,returnFocus}}><Feedback error={error} c={c}/>{member.allLocations&&<p className="text-sm text-amber-700">{c('memberAllLocationsHint')}</p>}<fieldset disabled={busy}><LocationChoices {...{api,c}} businessId={context.business.id} selected={selected} onChange={change}/></fieldset><button className={buttonClass} disabled={busy} onClick={close}>{c('close')}</button></Modal>;
}
