import { useState } from 'react';
import { useResource } from '../business-v2/useBusinessApi';
import { Feedback, Pager, panelClass } from '../business-v2/UI';
export default function TransferHistory({path,api,c,lang,timezone}){
 const [page,setPage]=useState(1),{data,error,reload}=useResource(api,`${path}/events?page=${page}`);
 return <section className="space-y-4"><h3 className="font-bold">{c('transferHistory')}</h3><Feedback {...{error,c}} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}
 {data&&<>{!data.items.length&&<p className="text-sm text-slate-500">{c('transferHistoryEmpty')}</p>}{data.items.map(event=><article key={event.id} className={`${panelClass} space-y-3`}><div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold text-sm">{c(`transferEvent${event.kind}`)}</h4><time className="text-xs text-slate-500" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString(lang==='ar'?'ar-AE':'en-GB',{timeZone:timezone})}</time></div><p className="text-sm text-slate-500">{event.actorName}</p><ul className="space-y-2 text-sm">{event.lines.map(line=><li key={line.id} className="flex flex-wrap gap-2 justify-between"><span className="break-words">{line.line.name} · <span dir="ltr">{line.line.sku}</span></span><span><span dir="ltr">{line.quantity}</span> {c(line.line.unit)}</span></li>)}</ul>{event.reason&&<p className="text-sm whitespace-pre-wrap break-words">{event.reason}</p>}</article>)}{data.total>0&&<Pager {...{data,setPage,c}}/>}</>}
 </section>;
}
