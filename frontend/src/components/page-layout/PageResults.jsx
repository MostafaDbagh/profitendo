import {createContext, useContext, useEffect, useRef} from 'react';
import {errorText} from '../business-v2/feedbackCopy';
import {ChevronLeft, ChevronRight, Inbox, Loader2} from 'lucide-react';
import {useLanguage} from '../../context/LanguageContext';
import {buttonClass, primaryClass, rowGap} from './tokens';

export function LoadingState({children, className='', ...props}) {
  return <p role="status" {...props} className={`flex items-center ${rowGap} text-sm text-slate-600 ${className}`}>
    <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-700 motion-safe:animate-spin"/>
    {children}
  </p>;
}

export function EmptyState({children, icon:Icon=Inbox, actions, className='', ...props}) {
  return <div className={`space-y-2 text-center text-sm text-slate-600 ${className}`} {...props}>
    <Icon aria-hidden="true" className="mx-auto h-6 w-6 text-slate-400"/>
    <p>{children}</p>
    {actions}
  </div>;
}

/** @param {{data: {page: number, pageSize: number, total: number}, setPage: (page: number) => void, c: (key: string) => string}} props */
export function Pager({data, setPage, c}) {
  const {lang}=useLanguage();
  const Previous=lang==='ar'?ChevronRight:ChevronLeft;
  const Next=lang==='ar'?ChevronLeft:ChevronRight;
  return <div className={`flex flex-wrap items-center justify-between ${rowGap} text-sm text-slate-600`}>
    <span>{c('page')} <bdi>{data.page}</bdi> · {c('total')} <bdi>{data.total}</bdi></span>
    <div className={`flex max-w-full flex-wrap ${rowGap}`}>
      <button type="button" className={buttonClass} disabled={data.page<=1} onClick={()=>setPage(data.page-1)}>
        <Previous aria-hidden="true"/>{c('previous')}
      </button>
      <button type="button" className={buttonClass} disabled={data.page*data.pageSize>=data.total} onClick={()=>setPage(data.page+1)}>
        {c('next')}<Next aria-hidden="true"/>
      </button>
    </div>
  </div>;
}

export const UpgradeContext = createContext(null);
export function Feedback({ error, notice, c, retry }) {
  const ref = useRef(null);
  const upgrade = useContext(UpgradeContext);
  const language=useLanguage();
  const limited = ['MEMBER_LIMIT_REACHED', 'LOCATION_LIMIT_REACHED'].includes(error);
  const lang=upgrade?.lang||language?.lang||'en';
  const ar = lang === 'ar';
  useEffect(() => { if (error || notice) ref.current?.focus(); }, [error, notice]);
  if (!error && !notice) return null;
  return <div ref={ref} tabIndex={-1} role={error ? 'alert' : 'status'} className={`p-3 rounded-lg border text-sm ${error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
    {error ? errorText(error,c,lang) : c(notice)}
    {limited && upgrade && <div className="mt-3 space-y-3"><p>{upgrade.canUpgrade ? (ar ? 'قم بترقية خطتك لإضافة المزيد.' : 'Upgrade your plan to add more.') : (ar ? 'تواصل مع مالك النشاط لترقية الخطة وإضافة المزيد.' : 'Contact your business owner to upgrade the plan and add more.')}</p>{upgrade.canUpgrade && <button type="button" className={primaryClass} onClick={upgrade.onUpgrade}>{ar ? 'ترقية الخطة' : 'Upgrade plan'}</button>}</div>}
    {error && retry && !limited && error !== 'SAVE_UNCONFIRMED' && <button type="button" className="underline ms-3 font-semibold" onClick={retry}>{c(error === 'REVISION_CONFLICT' ? 'reload' : 'retry')}</button>}
  </div>;
}
