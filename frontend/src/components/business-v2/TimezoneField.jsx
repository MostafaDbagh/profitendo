import {useMemo,useRef,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import RequiredMark from '../RequiredMark';
import {Field} from '../auth-v2/Fields';
import {Modal,buttonClass} from './UI';

const cities={
 'UTC':['UTC — Universal time','UTC — التوقيت العالمي'],
 'Asia/Damascus':['Damascus','دمشق'], 'Asia/Dubai':['Dubai','دبي'],
 'Asia/Riyadh':['Riyadh','الرياض'], 'Asia/Beirut':['Beirut','بيروت'],
 'Asia/Amman':['Amman','عمّان'], 'Asia/Baghdad':['Baghdad','بغداد'],
 'Asia/Kuwait':['Kuwait','الكويت'], 'Asia/Qatar':['Doha','الدوحة'],
 'Asia/Muscat':['Muscat','مسقط'], 'Asia/Bahrain':['Manama','المنامة'],
 'Asia/Aden':['Aden','عدن'], 'Africa/Cairo':['Cairo','القاهرة'],
 'Europe/Istanbul':['Istanbul','إسطنبول'], 'Europe/London':['London','لندن'],
 'Europe/Paris':['Paris','باريس'], 'Europe/Berlin':['Berlin','برلين'],
 'America/New_York':['New York','نيويورك'], 'America/Los_Angeles':['Los Angeles','لوس أنجلوس'],
};
export function timezoneLabel(zone,lang){
 return cities[zone]?.[lang==='ar'?1:0] || zone.split('/').reverse().join(' — ').replaceAll('_',' ');
}
export function timezoneOptions(current){
 let supported=[];
 try{supported=Intl.supportedValuesOf?.('timeZone')||[];}catch{/* Older browsers retain common zones and the saved value. */}
 return [...new Set([current,'UTC',...Object.keys(cities),...supported].filter(Boolean))];
}
const normalize=value=>value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f]/g,'').replace(/[أإآ]/g,'ا').replaceAll('_',' ').trim();
export default function TimezoneField({value,onChange,disabled,c,lang}){
 const [open,setOpen]=useState(false),[search,setSearch]=useState(''),trigger=useRef(null);
 const zones=useMemo(()=>timezoneOptions(value),[value]);
 const results=zones.filter(zone=>normalize(`${zone} ${timezoneLabel(zone,'en')} ${timezoneLabel(zone,'ar')}`).includes(normalize(search)));
 const ar=lang==='ar';
 return <div>
  <label htmlFor="business-timezone" className="block text-sm font-medium text-slate-700 mb-1.5">{c('timezone')}<RequiredMark/></label>
  <button ref={trigger} id="business-timezone" type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
   className={`${buttonClass} w-full min-h-11 !justify-between text-start`} onClick={()=>{setSearch('');setOpen(true);}}>
   <span className="min-w-0 break-words">{value?timezoneLabel(value,lang):(ar?'اختر المدينة':'Choose a city')}</span><ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0"/>
  </button>
  {open&&<Modal title={ar?'اختيار المنطقة الزمنية':'Choose time zone'} description={ar?'ابحث عن مدينتك أو مدينة تشترك معها في التوقيت.':'Find your city or a city in the same time zone.'}
   {...{c,lang}} returnFocus={trigger.current} close={()=>setOpen(false)}>
   <Field id="timezone-search" label={ar?'البحث عن مدينة':'Search for a city'} placeholder={ar?'مثال: دمشق أو دبي':'e.g. Damascus or Dubai'} value={search} onChange={event=>setSearch(event.target.value)} autoComplete="off" onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}}/>
   <ul className="max-h-64 overflow-y-auto space-y-1" aria-label={c('timezone')}>
    {results.map(zone=><li key={zone}><button type="button" disabled={disabled} aria-current={zone===value?'true':undefined}
     className={`w-full rounded-lg px-3 py-2.5 text-start text-sm focus-visible:ring-2 focus-visible:ring-emerald-500 ${zone===value?'bg-emerald-50 text-emerald-800':'hover:bg-slate-50'}`}
     onClick={()=>{onChange(zone);setOpen(false);}}>{timezoneLabel(zone,lang)}{zone===value&&<span className="ms-2 text-xs">{ar?'الحالية':'Current'}</span>}</button></li>)}
   </ul>
   {!results.length&&<p role="status" className="text-sm text-slate-500">{ar?'لم نجد هذه المدينة. جرّب مدينة قريبة بنفس التوقيت.':'No matching city. Try a nearby city in the same time zone.'}</p>}
   <button type="button" className={buttonClass} onClick={()=>setOpen(false)}>{c('close')}</button>
  </Modal>}
 </div>;
}
