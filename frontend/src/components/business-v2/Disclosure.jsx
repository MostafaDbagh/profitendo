import { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

// Keep saved optional values discoverable and reveal invalid fields before the
// browser focuses them. Collapsing a section never clears its values.
export default function Disclosure({title,children,hasValue=false,active=false,className=''}) {
 const ref=useRef(null),{lang}=useLanguage();
 useEffect(()=>{if(hasValue&&ref.current)ref.current.open=true;},[hasValue]);
 return <details ref={ref} className={`group min-w-0 rounded-lg border border-slate-200 bg-white ${className}`}
  onInvalidCapture={()=>{if(ref.current)ref.current.open=true;}}>
  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-500 [&::-webkit-details-marker]:hidden">
   <span>{title}</span>{active&&<span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{lang==='ar'?'تصفية مفعّلة':'Filtered'}</span>}
   <ChevronDown aria-hidden="true" className="ms-auto h-4 w-4 shrink-0 group-open:rotate-180"/>
  </summary>
  <div className="space-y-3 border-t border-slate-100 p-3">{children}</div>
 </details>;
}
export function OptionalFields(props){const {lang}=useLanguage();return <Disclosure title={lang==='ar'?'تفاصيل اختيارية':'Optional details'} {...props}/>;}
