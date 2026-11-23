import {toast} from 'sonner';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {CheckCircle2,WifiOff,Clock3,X} from 'lucide-react';
import {feedbackCopy} from './feedbackCopy';
const empty={pending:[],success:null},subscribe=()=>()=>{},getEmpty=()=>empty;
export default function RequestStatus({api,lang,businessId}){
 const status=useSyncExternalStore(api.feedback?.subscribe||subscribe,api.feedback?.getSnapshot||getEmpty);
 const [online,setOnline]=useState(()=>navigator.onLine!==false);
 useEffect(()=>{const update=()=>setOnline(navigator.onLine!==false);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
 const t=feedbackCopy[lang]||feedbackCopy.en,success=status.success?.scope===businessId?status.success:null;
 const shown=useRef(null),active=useRef(null);
 useEffect(()=>()=>{if(active.current)toast.dismiss(active.current.id);active.current=null;shown.current=null;},[]);
 useEffect(()=>{
  if(active.current&&(active.current.success!==success||active.current.scope!==businessId)){toast.dismiss(active.current.id);active.current=null;}
  if(!success||(shown.current===success&&!active.current))return;
  if(active.current?.lang===lang)return;
  shown.current=success;
  const clear=()=>{if(api.feedback.getSnapshot().success===success)api.feedback.dismiss();};
  const id=toast.custom(toastId=><div dir={lang==='ar'?'rtl':'ltr'} role="status" className="flex w-full items-start gap-3 rounded-xl border border-emerald-200 bg-white p-4 text-start text-sm text-slate-800 shadow-lg print:hidden">
   <span className="rounded-full bg-emerald-50 p-2 text-emerald-700"><CheckCircle2 aria-hidden="true" className="h-5 w-5"/></span>
   <div className="min-w-0 flex-1 py-1"><p className="font-semibold leading-relaxed">{t[success.key]}</p>{success.reference&&<bdi className="mt-1 block break-all text-xs text-slate-500">{success.reference}</bdi>}</div>
   <button type="button" aria-label={t.dismiss} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-500" onClick={clear}><X aria-hidden="true" className="h-4 w-4"/></button>
  </div>,{...(active.current?{id:active.current.id}:{}),duration:7000,onAutoClose:clear,onDismiss:clear});
  active.current={id,success,scope:businessId,lang};
 },[success,lang,t,api,businessId]);
 const pending=status.pending.length>0,write=status.pending.some(r=>r.write);
 if(online&&!pending)return null;
 return <div dir={lang==='ar'?'rtl':'ltr'} className="shrink-0 px-3 py-2 sm:px-5 print:hidden space-y-2">
  {(!online||pending)&&<div role="status" className="flex gap-3 items-center rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{!online?<WifiOff aria-hidden="true" className="h-5 w-5 shrink-0"/>:<Clock3 aria-hidden="true" className="h-5 w-5 shrink-0"/>}<span>{!online?t.offline:write?t.slowWrite:t.slowRead}</span></div>}

 </div>;
}
