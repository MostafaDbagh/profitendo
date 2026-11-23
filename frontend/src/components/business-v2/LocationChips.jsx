import {useEffect,useState} from 'react';
import {Check,Store,Warehouse} from 'lucide-react';
import {Feedback} from './UI';

export default function LocationChips({context,api,c,lang,value,onChange,disabled=false,all=false,label,excludeId}){
 const path=`/businesses/${context.business.id}/locations?state=${all?'all':'active'}`;
 const [state,setState]=useState({path:null,items:[],error:'',loading:true}),[version,setVersion]=useState(0);
 useEffect(()=>{
  if(disabled)return;
  const controller=new AbortController();
  setState({path,items:[],error:'',loading:true});
  (async()=>{
   try{
    const items=[];
    for(let page=1;;page++){
     const data=await api(`${path}&page=${page}`,{signal:controller.signal});
     if(controller.signal.aborted)return;
     const batch=data.items??[];items.push(...batch);
     if(!batch.length||items.length>=(data.total??items.length))break;
    }
    setState({path,items,error:'',loading:false});
   }catch(error){if(!controller.signal.aborted)setState({path,items:[],error:error.message,loading:false});}
  })();
  return ()=>controller.abort();
 },[api,path,disabled,version]);
 const current=state.path===path?state:{items:[],error:'',loading:true};
 const options=current.items.filter(item=>item.id!==excludeId);
 if(value&&!options.some(item=>item.id===value.id))options.unshift(value);
 return <div className="min-w-0 space-y-2" dir={lang==='ar'?'rtl':'ltr'}>
  <div role="group" aria-label={label||c('chooseLocation')} className="flex flex-wrap gap-2">
   {options.map(option=>{const selected=option.id===value?.id,Icon=option.kind==='WAREHOUSE'?Warehouse:Store;return <button key={option.id} type="button" aria-pressed={selected} disabled={disabled}
    className={`inline-flex min-h-11 max-w-full items-center gap-2.5 rounded-full border px-4 py-2.5 text-sm font-semibold text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${selected?'border-emerald-300 bg-emerald-50 text-emerald-800 shadow-sm':'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-50'}`}
    onClick={()=>onChange(option)}><Icon className={`h-4 w-4 shrink-0 ${selected?'text-emerald-600':'text-slate-400'}`} aria-hidden="true"/><bdi className="break-words min-w-0">{option.name}</bdi>{selected&&<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"><Check className="h-3 w-3" strokeWidth={3} aria-hidden="true"/></span>}</button>;})}
  </div>
  {!disabled&&<><Feedback c={c} error={current.error} retry={()=>setVersion(v=>v+1)}/>{current.loading&&<p role="status" className="text-sm text-slate-500">{c('loading')}</p>}{!current.loading&&!current.error&&!options.length&&<p className="text-sm text-slate-500">{lang==='ar'?'لا توجد متاجر متاحة.':'No stores available.'}</p>}</>}
 </div>;
}
