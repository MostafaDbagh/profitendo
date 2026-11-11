import { useState } from 'react';
import { useResource } from './useBusinessApi';
import { Feedback, Modal, Pager, buttonClass } from './UI';
export default function LocationAssignments({ location, path, api, c, lang, close, returnFocus }) {
  const [page,setPage] = useState(1), [busy,setBusy] = useState(false), [failure,setFailure] = useState(''), [notice,setNotice] = useState('');
  const {data,error,reload} = useResource(api,`${path}/${location.id}/assignments?page=${page}`);
  async function toggle(member) {
    setBusy(true);setFailure('');setNotice('');
    try {await api(`${path}/${location.id}/assignments`,{method:'PUT',body:{revision:data.revision,membershipId:member.id,assigned:!member.assigned}});setNotice('saved');reload();}
    catch(e){setFailure(e.message);}finally{setBusy(false);}
  }
  return <Modal title={`${c('locationAssignments')} · ${location.name}`} description={c('locationAssignmentHint')} {...{close,returnFocus,lang,c,busy}}>
    <Feedback error={error || failure} notice={notice} c={c} retry={()=>{setFailure('');reload();}} />
    {!data && !error && <p role="status">{c('loading')}</p>}
    {data && <><ul className="divide-y divide-slate-100">{data.items.map(m => <li key={m.id} className="py-3 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-sm break-words">{m.name}</p><p className="text-xs text-slate-500">{c(m.role)} · {c(m.active?'active':'inactive')}</p></div>{m.allLocations && !m.assigned ? <span className="text-xs text-slate-500">{c('allLocationAccess')}</span> : <button className={buttonClass} disabled={busy || (!m.active && !m.assigned) || !!failure} aria-label={`${c(m.assigned?'unassignLocation':'assignLocation')} · ${m.name}`} onClick={()=>toggle(m)}>{c(m.assigned?'unassignLocation':'assignLocation')}</button>}</li>)}</ul><Pager data={data} c={c} setPage={value=>{if(!busy){setFailure('');setNotice('');setPage(value);}}} /></>}
  </Modal>;
}
