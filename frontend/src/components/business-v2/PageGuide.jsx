import {useId,useState} from 'react';
import {ChevronDown,Info} from 'lucide-react';
import {pageGuides} from './pageGuides';

export default function PageGuide({section,lang,title}) {
 const [open,setOpen]=useState(false),id=useId(),ar=lang==='ar';
 const copy=pageGuides[section]?.[ar?'ar':'en'];
 if(!copy)return null;
 return <aside className="rounded-lg border border-slate-200 bg-white px-4 py-3" aria-label={ar?`دليل ${title}`:`About ${title}`} data-testid="page-guide" data-section={section}>
  <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
   <Info className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" aria-hidden="true"/>
   <p className="flex-1 min-w-0 text-sm text-slate-600">{copy[0]}</p>
   <button type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)} className="inline-flex items-center gap-1 rounded text-sm font-medium text-emerald-700 px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
    {ar?(open?'عرض أقل':'اقرأ المزيد'):(open?'Read less':'Read more')}<ChevronDown className={`h-4 w-4 ${open?'rotate-180':''}`} aria-hidden="true"/>
   </button>
  </div>
  <div id={id} hidden={!open} className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
   <ul className="list-disc ps-5 space-y-2 leading-relaxed">{copy.slice(1).map(text=><li key={text}>{text}</li>)}</ul>
   <p className="mt-3 text-xs text-slate-500">{ar?'الإجراءات المتاحة تعتمد على صلاحياتك وحالة اشتراك النشاط.':'Available actions depend on your permissions and the business subscription status.'}</p>
  </div>
 </aside>;
}
