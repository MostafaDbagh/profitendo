import {LoadingState} from '../page-layout/PageResults';
import {useEffect,useId} from 'react';
import {Check,MapPin,Store,Warehouse} from 'lucide-react';
import RequiredMark from '../RequiredMark';
import {Feedback,Select} from './UI';
import useLocationOptions from './useLocationOptions';

export const locationIcons={SHOP:Store,WAREHOUSE:Warehouse};

export function LocationChipGroup({label,required=false,children}){
 const labelId=useId();
 return <div className="grid min-w-0 grid-cols-[fit-content(40%)_minmax(0,1fr)] items-start gap-[var(--page-control-gap)]">
  <span id={labelId} className="content-center min-h-[var(--page-control-height)] text-sm font-medium text-slate-700">
   {label}<RequiredMark required={required}/><span aria-hidden="true">:</span>
  </span>
  <div role="group" aria-labelledby={labelId} className="flex min-w-0 flex-wrap items-center gap-[var(--page-control-gap)]">{children}</div>
 </div>;
}

export default function LocationChips({context,api,c,lang,value,onChange,disabled=false,all=false,label,required=false,excludeId,documentLocation,defaultSingle=false,asSelect=false}){
 const path=`/businesses/${context.business.id}/locations?state=${all?'all':'active'}`;
 const current=useLocationOptions(api,documentLocation?null:path);
 const options=(documentLocation?[documentLocation]:current.items).filter(item=>item.id!==excludeId);
 const validSelection=options.some(item=>item.id===value?.id);
 const soleOption=defaultSingle&&!disabled&&!documentLocation&&options.length===1?options[0]:null;
 useEffect(()=>{
  if(soleOption&&!validSelection){onChange(soleOption);return;}
  if(value&&!documentLocation&&!current.loading&&!current.error&&!validSelection)onChange(null);
 },[soleOption,value,documentLocation,current.loading,current.error,validSelection,onChange]);
 return <div className="min-w-0 space-y-2" dir={lang==='ar'?'rtl':'ltr'}>
  {asSelect ? <Select id="report-location" label={label||c('chooseLocation')} value={value?.id||''} disabled={disabled||current.loading} onChange={event=>onChange(options.find(item=>item.id===event.target.value)||null)}>
   <option value="">{c('allLocations')}</option>
   {options.map(option=><option key={option.id} value={option.id} dir="auto">{option.name}</option>)}
  </Select> : <LocationChipGroup label={label||c('chooseLocation')} required={required}>
   {options.map(option=>{const selected=Boolean(documentLocation)||option.id===value?.id,Icon=locationIcons[option.kind]??MapPin;return <button key={option.id} type="button" aria-pressed={selected} disabled={disabled||Boolean(documentLocation)}
    className={`relative inline-flex min-h-11 max-w-full items-center gap-2.5 rounded-full border px-4 py-2.5 text-sm font-semibold text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${selected?'border-emerald-300 bg-emerald-50 text-emerald-800 shadow-sm':'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-50'}`}
    onClick={()=>onChange(option)}>{selected&&soleOption&&<span className="absolute -top-2 right-3 rounded-full bg-emerald-700 px-2 text-[10px] font-semibold leading-4 text-white">{lang==='ar'?'افتراضيا':'Default'}</span>}<Icon className={`h-4 w-4 shrink-0 ${selected?'text-emerald-600':'text-slate-400'}`} aria-hidden="true"/><bdi className="break-words min-w-0">{option.name}</bdi>{selected&&<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"><Check className="h-3 w-3" strokeWidth={3} aria-hidden="true"/></span>}</button>;})}
  </LocationChipGroup>}
  {!documentLocation&&<><Feedback c={c} error={current.error} retry={current.reload}/>{current.loading&&<LoadingState className="text-sm text-slate-500">{c('loading')}</LoadingState>}{!current.loading&&!current.error&&!options.length&&<p className="text-sm text-slate-500">{lang==='ar'?'لا توجد متاجر أو مستودعات متاحة.':'No shops or warehouses available.'}</p>}</>}
 </div>;
}
