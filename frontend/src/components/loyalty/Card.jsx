import {useState} from 'react';
import {useResource} from '../business-v2/useBusinessApi';
import {Feedback,buttonClass} from '../business-v2/UI';

export default function Card({api,path,id,locationId,c,lang,history=false,saleId,completed=false}){
 const ar=lang==='ar';
 const [page,setPage]=useState(1);
 const {data,error,reload}=useResource(api,id?`${path}/customers/${id}?page=${page}`:null);
 const [busy,setBusy]=useState(false),[failure,setFailure]=useState('');
 if(!data)return <Feedback c={c} error={error} retry={reload}/>;
 const {program,progress,rewards}=data;
 const stages=[...program.stages].sort((a,b)=>a.step-b.step);
 const next=stages.find(s=>s.step>progress);
 const credited=data.visits.some(v=>v.saleId===saleId&&!v.reversed);
 async function redeem(reward){
  setBusy(true);setFailure('');
  try{await api(`${path}/rewards/${reward.id}/redeem`,{method:'POST',body:{locationId}});reload();}catch(e){setFailure(e.message);}finally{setBusy(false);}
 }
 return <div className="space-y-2 text-sm" aria-live="polite">
  {program.enabled&&<p>{progress} / {program.length} {ar?'زيارات':'visits'}{next&&<> · {ar?'الهدية القادمة عند الزيارة':'Next gift at visit'} {next.step}</>}</p>}
  {program.enabled&&!history&&(data.today?<p>{credited&&completed?(ar?'سُجّلت زيارة اليوم':'Today’s visit recorded'):(ar?'احتُسبت زيارة اليوم بالفعل':'Today’s visit has already been counted')}</p>:!completed&&next?.step===progress+1&&<p className="text-emerald-700">{ar?'بإتمام هذه العملية تستحق هدية الزيارة':'Complete this sale to earn the gift for visit'} {next.step} · {next.name}</p>)}
  <Feedback c={c} error={failure}/>
  {rewards.filter(r=>history||(!r.voided&&!r.redeemedAt)).map(r=><div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 p-2">
   <strong>{r.name}</strong><span>{r.redeemedAt?(ar?'تم التسليم':'Redeemed'):r.voided?(ar?'ملغاة':'Voided'):(ar?'متاحة للاستلام':'Available')}</span>
   {r.redeemedAt&&<small>{[r.redeemedName,new Date(r.redeemedAt).toLocaleString(lang,{dateStyle:'short',timeStyle:'short',timeZone:data.timezone})].filter(Boolean).join(' · ')}</small>}{r.voided&&r.redeemedAt&&<small>{ar?'أُعيدت الفاتورة بعد التسليم':'Invoice returned after redemption'}</small>}
   {!r.redeemedAt&&!r.voided&&locationId&&<button type="button" disabled={busy} className={buttonClass} onClick={()=>redeem(r)}>{ar?'تسليم الهدية':'Redeem gift'}</button>}
  </div>)}
  {history&&<><strong>{ar?'إجمالي الزيارات':'Total visits'} · {data.count}</strong><ul className="divide-y">{data.visits.map(v=><li key={v.id} className="py-2"><bdi>{v.day}</bdi> · {ar?'الدورة':'Cycle'} {v.cycle} · {ar?'الزيارة':'Visit'} {v.step}{v.reversed&&(ar?' · مرتجعة':' · Reversed')}</li>)}</ul><div className="flex gap-2">{page>1&&<button className={buttonClass} onClick={()=>setPage(n=>n-1)}>{ar?'السابق':'Previous'}</button>}{data.hasMore&&<button className={buttonClass} onClick={()=>setPage(n=>n+1)}>{ar?'التالي':'Next'}</button>}</div></>}
 </div>;
}
