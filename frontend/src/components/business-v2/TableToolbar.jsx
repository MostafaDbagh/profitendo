import { ChevronDown, Download } from 'lucide-react';
import { useId, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';

const controlClass = 'flex h-11 min-w-0 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-1.5 text-center text-xs font-semibold leading-tight text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 sm:px-2 sm:text-sm';

export function TableCsvButton({ label, disabled, onClick }) {
  const { lang } = useLanguage();
  const shortLabel = lang === 'ar' ? 'تصدير CSV' : 'Export CSV';
  const accessibleLabel = label || shortLabel;

  return (
    <button type="button" className={controlClass} aria-label={accessibleLabel} title={accessibleLabel}
      disabled={disabled} onClick={onClick}>
      <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="sm:hidden" aria-hidden="true">CSV</span>
      <span className="hidden sm:inline lg:hidden" aria-hidden="true">{shortLabel}</span>
      <span className="hidden lg:inline" aria-hidden="true">{accessibleLabel}</span>
    </button>
  );
}

export default function TableToolbar({ search, filters, filtersActive, exportAction }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const optionsLabel = ar ? 'خيارات إضافية' : 'More options';
  const activeLabel = ar ? 'تصفية مفعّلة' : 'Filtered';
  const columns = search && exportAction
    ? 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]'
    : search ? 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : 'grid-cols-2';

  return (
    <div className="space-y-2 sm:space-y-3" dir={ar ? 'rtl' : 'ltr'}>
      <div className={`grid items-end gap-2 sm:gap-3 ${columns}`}>
        {search && <div className="min-w-0 [&_input]:min-h-11">{search}</div>}
        <button type="button" className={`${controlClass} relative ${filtersActive ? '!border-emerald-200 !bg-emerald-50 !text-emerald-800' : ''}`}
          aria-expanded={expanded} aria-controls={id} aria-label={filtersActive ? `${optionsLabel} (${activeLabel})` : optionsLabel}
          onClick={() => setExpanded(open => !open)}>
          <span className="sm:hidden" aria-hidden="true">{ar ? 'خيارات' : 'Options'}</span>
          <span className="hidden sm:inline" aria-hidden="true">{optionsLabel}</span>
          <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 ${expanded ? 'rotate-180' : ''}`} />
          {filtersActive && <span aria-hidden="true" className="absolute end-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-600" />}
        </button>
        {exportAction && <div className="min-w-0 [&>button]:w-full">{exportAction}</div>}
      </div>
      <div id={id} hidden={!expanded} className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
        {filters}
      </div>
    </div>
  );
}
