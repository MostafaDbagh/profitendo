import { ArrowRight, ListChecks, X } from 'lucide-react';
import { useState } from 'react';
import { buttonClass, panelClass, primaryClass } from './UI';
import { useWorkspaceSetup } from './workspaceSetup';

export default function SetupProgressCard(props) {
  const {business, membershipId} = props.context;
  const storageKey = `profitlens:hide-workspace-setup:${business.id}:${membershipId}`;
  return <DismissibleSetupCard key={storageKey} {...props} storageKey={storageKey} />;
}

function DismissibleSetupCard({storageKey, ...props}) {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1'; }
    catch { return false; }
  });
  if (hidden) return null;

  function hide() {
    setHidden(true);
    try { localStorage.setItem(storageKey, '1'); }
    catch { /* Dismissal still applies in this view. */ }
  }

  return <SetupCard {...props} onHide={hide} />;
}

function SetupCard({context, api, lang, onSection, visibleTabs, onHide}) {
  const steps = useWorkspaceSetup(context, api, visibleTabs);
  const completed = steps.filter(step => step.complete).length;
  const progressKnown = steps.every(step => step.complete !== null);
  if (completed === steps.length) return null;

  const ar = lang === 'ar';
  const title = ar ? 'جهّز متجرك لأول عملية بيع' : 'Get ready for your first sale';
  const format = new Intl.NumberFormat(lang);
  const progressLabel = ar
    ? `اكتملت ${format.format(completed)} من ${format.format(steps.length)} خطوات`
    : `${completed} of ${steps.length} steps complete`;
  return <section dir={ar ? 'rtl' : 'ltr'} aria-labelledby="workspace-setup-title" className={`${panelClass} border-emerald-200`}>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {progressKnown ? (
          <div role="progressbar" aria-labelledby="workspace-setup-title" aria-valuemin={0}
            aria-valuemax={steps.length} aria-valuenow={completed} aria-valuetext={progressLabel}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full"
            style={{background: `conic-gradient(hsl(var(--primary)) ${completed / steps.length * 100}%, hsl(var(--accent)) 0)`}}>
            <bdi aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full bg-white text-xs font-semibold tabular-nums text-emerald-800">
              {format.format(completed)}/{format.format(steps.length)}
            </bdi>
          </div>
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
            <ListChecks className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
        <div>
          <h3 id="workspace-setup-title" className="font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {ar ? 'أضف متجرك ومنتجاتك، ثم سجّل أول عملية بيع.' : 'Add your shop and products, then record your first sale.'}
          </p>
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <button type="button" className={primaryClass} onClick={() => onSection('guidance')}>
        {ar ? 'استئناف الإعداد' : 'Continue setup'}
        <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </button>
      <button type="button" className={buttonClass} onClick={onHide}>
        <X className="h-4 w-4" aria-hidden="true" />{ar ? 'إخفاء' : 'Hide'}
      </button>
      </div>
    </div>
  </section>;
}
