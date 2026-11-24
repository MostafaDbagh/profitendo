import {forwardRef} from 'react';
import {Loader2} from 'lucide-react';
import {buttonClass, primaryClass, stack, rowGap, surface, focusRing} from './tokens';
import {useLanguage} from '../../context/LanguageContext';

/** @typedef {import('react').ReactNode} Slot */
/**
 * @typedef {Object} Action
 * @property {string} id
 * @property {string} label
 * @property {import('react').ElementType} [icon]
 * @property {import('react').MouseEventHandler<HTMLButtonElement>} [onClick]
 * @property {'primary'|'secondary'} [variant]
 * @property {boolean} [visible]
 * @property {boolean} [disabled]
 * @property {boolean} [loading]
 * @property {boolean} [pressed]
 */

/** @param {{items?: Action[], children?: Slot}} props */
export function PageActions({items=[],children}) {
  const actions=items.filter(action=>action.visible!==false);
  if (!actions.length && !children) return null;
  return <div className={`flex min-w-0 flex-wrap items-center ${rowGap} empty:hidden [&>div]:max-w-full [&>div]:flex-wrap [&_a]:min-h-[var(--page-control-height)] [&_button]:min-h-[var(--page-control-height)]`}>
    {actions.map(({id,label,icon:Icon,onClick,variant,disabled,loading,pressed})=>
      <button key={id} type="button" className={variant==='primary' ? `${primaryClass} aria-pressed:!bg-[hsl(var(--page-action-hover))]` :
          `${buttonClass} aria-pressed:border-emerald-200 aria-pressed:bg-accent aria-pressed:text-accent-foreground`}
        onClick={onClick} disabled={disabled||loading} aria-busy={loading||undefined} aria-pressed={pressed}>
        {loading?<Loader2 className="motion-safe:animate-spin" aria-hidden="true"/>:Icon&&<Icon aria-hidden="true"/>}
        <span className="min-w-0 break-words">{label}</span>
      </button>
    )}
    {children}
  </div>;
}

/** @param {{title: Slot, actions?: Action[], accessory?: Slot, heading?: 'h1'|'h2', titleId?: string, titleTestId?: string}} props */
export function PageHeader({title,actions,accessory,heading:Heading='h2',titleId,titleTestId}) {
  return <header className={`flex min-w-0 flex-wrap items-center justify-between ${rowGap}`}>
    <Heading id={titleId} data-testid={titleTestId} className="min-w-0 max-w-full break-words text-xl font-bold leading-tight text-foreground sm:text-2xl">{title}</Heading>
    <PageActions items={actions}>{accessory}</PageActions>
  </header>;
}

/** @param {{title?: Slot, actions?: Action[], accessory?: Slot, heading?: 'h1'|'h2', toolbar?: Slot, status?: Slot, pagination?: Slot, titleId?: string, titleTestId?: string, children?: Slot, as?: import('react').ElementType, className?: string} & Omit<import('react').HTMLAttributes<HTMLElement>, 'title'>} props */
export function PageLayout({title,actions,accessory,heading,toolbar,status,pagination,titleId,titleTestId,children,as:Component='section',className='',...props}) {
  return <Component className={`${stack} ${className}`} {...props}>
    {title!=null&&<PageHeader {...{title,heading,actions,accessory,titleId,titleTestId}}/>}
    {toolbar}
    {status}
    {children}
    {pagination}
  </Component>;
}

export const PageContainer=forwardRef(function PageContainer({as:Component='main',className='',...props},ref) {
  return <Component ref={ref} className={`mx-auto w-full min-w-0 max-w-7xl px-[var(--page-gutter)] py-[var(--page-gap)] ${className}`} {...props}/>;
});

export function TableRegion({className='',...props}) {
  const {lang}=useLanguage();
  return <div role="region" aria-label={lang==='ar'?'جدول البيانات':'Data table'} tabIndex={0}
    className={`${surface} min-w-0 max-w-full overflow-x-auto shadow-sm ${focusRing} ${className}`} {...props}/>;
}
