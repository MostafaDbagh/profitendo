import { ChevronDown, Download, Search } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

import {controlHeight, fieldSurface, focusRing, primaryTone, rowGap} from './tokens';

const controlClass = `flex min-w-0 w-full items-center justify-center gap-1.5 ${fieldSurface} px-1.5 py-1 text-center !text-xs font-semibold leading-tight text-slate-700 hover:bg-muted ${focusRing} disabled:opacity-50 sm:px-2 sm:!text-sm`;

export function TableSearchButton({ label, type = 'submit', disabled, onClick }) {
  return (
    <button type={type} disabled={disabled} onClick={onClick} aria-label={label}
      className={`${controlClass} ${primaryTone} !w-auto shrink-0 !px-2 sm:!px-3`}>
      <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function TableCsvButton({ label, compactLabel, disabled, onClick }) {
  const { lang } = useLanguage();
  const shortLabel = lang === 'ar' ? 'تصدير CSV' : 'Export CSV';
  const accessibleLabel = label || shortLabel;

  return (
    <button type="button" className={controlClass} aria-label={accessibleLabel} title={accessibleLabel}
      disabled={disabled} onClick={onClick}>
      <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="sm:hidden" aria-hidden="true">{compactLabel || 'CSV'}</span>
      <span className="hidden sm:inline lg:hidden" aria-hidden="true">{compactLabel || shortLabel}</span>
      <span className="hidden lg:inline" aria-hidden="true">{accessibleLabel}</span>
    </button>
  );
}

/** @typedef {import('react').ReactNode} Slot */
/** @param {{search?: Slot, primaryFilters?: Slot, filters?: Slot, filtersActive?: boolean, importAction?: Slot, exportAction?: Slot}} props */
export default function PageToolbar({ optionsOverride, layout, search, primaryFilters, filters, filtersActive, importAction, exportAction }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  const optionsLabel = optionsOverride || (ar ? 'خيارات بحث إضافية' : 'More options');
  const activeLabel = ar ? 'تصفية مفعّلة' : 'Filtered';
  if (!search && !primaryFilters && !filters && !importAction && !exportAction) return null;

  const extraControls = primaryFilters || importAction;
  const columns = search && filters && exportAction
    ? 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]'
    : search && (filters || exportAction)
      ? 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'
      : filters && exportAction ? 'grid-cols-2' : 'grid-cols-1';
  const alignment = layout==='report'
    ? 'grid grid-cols-2 sm:grid-cols-[minmax(12rem,2fr)_minmax(9rem,1fr)_minmax(7rem,auto)] [&>div:first-child]:col-span-2 sm:[&>div:first-child]:col-span-1'
    : extraControls ? 'flex flex-wrap' : `grid ${columns}`;

  return (
    <Popover>
      <div dir={dir} className={`${alignment} min-w-0 items-end ${rowGap}`}>
        {primaryFilters && <div className={`flex min-w-0 max-w-full flex-wrap items-end ${rowGap}`}>{primaryFilters}</div>}
        {search && <div className="min-w-0 flex-[2_1_12rem] [&_input]:min-h-[var(--page-control-height)] [&_input]:border-primary [&_input]:bg-emerald-50/40">{search}</div>}
        {filters && <PopoverTrigger asChild>
          <button type="button" className={`${controlClass} group relative ${extraControls?'!w-auto flex-[1_1_7rem]':''} ${filtersActive ? '!border-emerald-200 !bg-accent !text-accent-foreground' : ''}`}
            aria-label={filtersActive ? `${optionsLabel} (${activeLabel})` : optionsLabel}>
            <span className="sm:hidden" aria-hidden="true">{optionsOverride || (ar ? 'خيارات بحث' : 'Options')}</span>
            <span className="hidden sm:inline" aria-hidden="true">{optionsLabel}</span>
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 group-data-[state=open]:rotate-180 sm:h-4 sm:w-4" />
            {filtersActive && <span aria-hidden="true" className="absolute end-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />}
          </button>
        </PopoverTrigger>}
        {importAction && <div className={`flex min-w-0 items-end [&>button]:w-full ${controlHeight}`}>{importAction}</div>}
        {exportAction && <div className="min-w-0 flex-[1_1_6rem] [&>button]:w-full">{exportAction}</div>}
      </div>
      {filters && <PopoverContent dir={dir} aria-label={optionsLabel} sideOffset={8} collisionPadding={12}
        className="max-h-[var(--radix-popover-content-available-height)] w-[min(30rem,var(--radix-popover-content-available-width))] space-y-3 overflow-y-auto rounded-lg border-border bg-card p-3 text-start motion-reduce:animate-none">
        {filters}
      </PopoverContent>}
    </Popover>
  );
}
