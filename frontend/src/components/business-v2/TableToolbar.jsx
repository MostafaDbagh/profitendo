import { ChevronDown, Download, Search } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

const controlClass = 'flex h-11 min-w-0 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-1.5 text-center text-xs font-semibold leading-tight text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 sm:px-2 sm:text-sm';

export function TableSearchButton({ label, type = 'submit', disabled, onClick }) {
  return (
    <button type={type} disabled={disabled} onClick={onClick} aria-label={label}
      className={`${controlClass} !w-auto shrink-0 !border-emerald-500 !bg-emerald-500 !px-2 !text-white hover:!bg-emerald-600 sm:!px-3`}>
      <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

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
  const dir = ar ? 'rtl' : 'ltr';
  const optionsLabel = ar ? 'خيارات بحث إضافية' : 'More options';
  const activeLabel = ar ? 'تصفية مفعّلة' : 'Filtered';
  const columns = search && exportAction
    ? 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]'
    : search ? 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : 'grid-cols-2';

  return (
    <Popover>
      <div dir={dir} className={`grid items-end gap-2 sm:gap-3 ${columns}`}>
        {search && <div className="min-w-0 [&_input]:min-h-11 [&_input]:border-emerald-500 [&_input]:bg-emerald-50/40">{search}</div>}
        <PopoverTrigger asChild>
          <button type="button" className={`${controlClass} group relative ${filtersActive ? '!border-emerald-200 !bg-emerald-50 !text-emerald-800' : ''}`}
            aria-label={filtersActive ? `${optionsLabel} (${activeLabel})` : optionsLabel}>
            <span className="sm:hidden" aria-hidden="true">{ar ? 'خيارات بحث' : 'Options'}</span>
            <span className="hidden sm:inline" aria-hidden="true">{optionsLabel}</span>
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 group-data-[state=open]:rotate-180 sm:h-4 sm:w-4" />
            {filtersActive && <span aria-hidden="true" className="absolute end-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-600" />}
          </button>
        </PopoverTrigger>
        {exportAction && <div className="min-w-0 [&>button]:w-full">{exportAction}</div>}
      </div>
      <PopoverContent dir={dir} aria-label={optionsLabel} sideOffset={8} collisionPadding={12}
        className="max-h-[var(--radix-popover-content-available-height)] w-[min(30rem,var(--radix-popover-content-available-width))] space-y-3 overflow-y-auto rounded-lg border-slate-200 bg-white p-3 text-start motion-reduce:animate-none">
        {filters}
      </PopoverContent>
    </Popover>
  );
}
