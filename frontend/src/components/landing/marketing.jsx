import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingCart, ShoppingBag, Boxes, Wallet, BookOpenCheck, BarChart3,
  ArrowDown, Bot, PanelsTopLeft, FileCheck2,
  Store, Building2, Factory, Truck, Briefcase, CheckCircle2, UserPlus, PackagePlus, Rocket,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { REGISTER_URL } from "./chrome";

const sectionCls = "max-w-6xl mx-auto px-5 py-16 sm:py-24";

function SectionTitle({ title, sub, testid, headingLevel: Heading = "h2" }) {
  return (
    <div className="text-center max-w-2xl mx-auto mb-12">
      <Heading className="text-3xl sm:text-4xl font-extrabold text-slate-100" data-testid={testid}>{title}</Heading>
      {sub && <p className="text-slate-400 mt-4 leading-relaxed">{sub}</p>}
    </div>
  );
}

export function Hero() {
  const { t } = useLanguage();
  return (
    <section className="relative overflow-hidden" data-testid="lp-hero">
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-40 start-1/3 w-[500px] h-[500px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-40 -end-32 w-96 h-96 rounded-full bg-teal-500/10 blur-3xl" />
      </div>
      <div className={`${sectionCls} relative text-center pt-20 sm:pt-28`}>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-50 leading-tight" data-testid="lp-hero-title">
          {t("lpHeroTitle")}
        </h1>
        <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto mt-6 leading-relaxed" data-testid="lp-hero-sub">
          {t("lpHeroSub")}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-10">
          <Link to={REGISTER_URL} data-testid="lp-hero-cta-start"
            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-base transition-all shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:-translate-y-0.5">
            {t("lpHeroCta")}
          </Link>
          <a href="#features" data-testid="lp-hero-cta-demo"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl border border-slate-700 text-slate-200 font-bold hover:border-emerald-500/50 hover:text-emerald-300 transition-colors">
            <ArrowDown className="w-4 h-4" />
            {t("lpHeroCta2")}
          </a>
        </div>
        <p className="text-sm text-emerald-400/90 font-semibold mt-6" data-testid="lp-hero-trust">{t("lpHeroTrust")}</p>
      </div>
    </section>
  );
}

export function Modules({ headingLevel = "h2" }) {
  const { t } = useLanguage();
  const mods = [
    ["sales", ShoppingCart, "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"],
    ["purchases", ShoppingBag, "text-sky-400 bg-sky-500/10 border-sky-500/30"],
    ["inventory", Boxes, "text-violet-400 bg-violet-500/10 border-violet-500/30"],
    ["cash", Wallet, "text-teal-400 bg-teal-500/10 border-teal-500/30"],
    ["accounting", BookOpenCheck, "text-amber-400 bg-amber-500/10 border-amber-500/30"],
    ["reports", BarChart3, "text-rose-400 bg-rose-500/10 border-rose-500/30"],
  ];
  return (
    <section id="features" className={sectionCls} data-testid="lp-features">
      <SectionTitle headingLevel={headingLevel} title={t("lpModulesTitle")} testid="lp-modules-title" />
      <div className="grid md:grid-cols-2 gap-8 md:gap-12 border-y border-emerald-200 py-8 mb-8" data-testid="lp-feature-highlights">
        {[["dashboard", PanelsTopLeft], ["closing", FileCheck2]].map(([key, Icon]) => <article key={key} className="text-start">
          <Icon className="w-7 h-7 text-emerald-700 mb-4" aria-hidden="true" />
          <h3 className="text-xl font-bold text-slate-900 mb-3">{t(`lpHighlight_${key}`)}</h3>
          <p className="text-sm leading-loose text-slate-600">{t(`lpHighlight_${key}_d`)}</p>
          <p className="text-sm font-semibold text-emerald-800 mt-4">{t(`lpHighlight_${key}_note`)}</p>
        </article>)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {mods.map(([key, Icon, tone]) => (
          <div key={key} data-testid={`lp-module-${key}`}
            className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 hover:border-slate-600 hover:-translate-y-1 transition-all duration-200">
            <span className={`w-12 h-12 rounded-xl border flex items-center justify-center mb-4 ${tone}`}>
              <Icon className="w-6 h-6" />
            </span>
            <h3 className="font-bold text-lg text-slate-100 mb-2">{t(`lpMod_${key}`)}</h3>
            <p className="text-sm text-slate-400 leading-relaxed">{t(`lpMod_${key}_d`)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Accounting() {
  const { t } = useLanguage();
  return (
    <section className="border-y border-slate-800/60 bg-slate-900/40" data-testid="lp-accounting">
      <div className={sectionCls}>
        <SectionTitle title={t("lpAccTitle")} sub={t("lpAccSub")} testid="lp-acc-title" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} data-testid={`lp-acc-${n}`} className="flex items-start gap-3 bg-slate-950/60 border border-slate-800 rounded-xl p-5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-sm text-slate-300 leading-relaxed">{t(`lpAcc${n}`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AiSection() {
  const { t } = useLanguage();
  return (
    <section className={sectionCls} data-testid="lp-ai">
      <div className="relative rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-slate-900/60 to-teal-500/10 p-8 sm:p-14 overflow-hidden">
        <div className="absolute -top-24 -end-24 w-72 h-72 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="relative max-w-3xl">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-extrabold mb-6" data-testid="lp-ai-premium-badge">
            <Bot className="w-4 h-4" /> {t("lpAiComingSoon")}
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-50 leading-tight" data-testid="lp-ai-title">{t("lpAiTitle")}</h2>
          <p className="text-slate-300 mt-5 leading-relaxed" data-testid="lp-ai-desc">{t("lpAiDesc")}</p>
          <p className="text-emerald-300/90 font-bold text-sm mt-4" data-testid="lp-ai-tag">{t("lpAiTag")}</p>

        </div>
      </div>
    </section>
  );
}

export function KpiPreview() {
  const { t, lang } = useLanguage();
  const [period, setPeriod] = useState('month');
  const ar = lang === 'ar';
  const values = period === 'month'
    ? ['120,000', '72,000', '48,000', '30,000', '25%', '86,000', '42,000', '40%']
    : ['32,000', '19,200', '12,800', '8,000', '25%', '86,000', '42,000', '40%'];
  const labels = ['lpKpiSales','lpKpiCogs','lpKpiGross','lpKpiNet','lpKpiMargin','lpKpiInventory','lpKpiCash','lpKpiProducts'];
  return <section className={`${sectionCls} report-section`} data-testid="lp-kpis">
    <div className="report-intro">
      <SectionTitle title={t('lpKpiTitle')} sub={t('lpKpiSub')} testid="lp-kpi-title"/>
      <p className="report-disclaimer">{ar ? 'مثال توضيحي ببيانات تجريبية، وليس تقريرًا من حسابك.' : 'An illustrative preview with sample data, not a report from your account.'}</p>
    </div>
    <div className="report-preview">
      <div className="report-toolbar">
        <span>{ar ? 'ملخص الأداء' : 'Performance summary'}</span>
        <div className="report-period" role="group" aria-label={ar ? 'فترة المثال' : 'Sample period'}>
          {[['month', ar ? 'هذا الشهر' : 'This month'], ['week', ar ? 'هذا الأسبوع' : 'This week']].map(([key,label])=><button key={key} type="button" aria-pressed={period===key} onClick={()=>setPeriod(key)}>{label}</button>)}
        </div>
      </div>
      <dl className="report-ledger" aria-live="polite">
        {labels.map((key,i)=><div className={i===3 ? 'report-result' : ''} key={key}>
          <dt>{t(key)}{i===7 && <small>{ar ? 'هامش المنتج التجريبي' : 'Sample product margin'}</small>}</dt>
          <dd><bdi>{values[i]}</bdi>{![4,7].includes(i)&&<small>{ar?'ل.س':'SYP'}</small>}</dd>
        </div>)}
      </dl>
    </div>
  </section>;
}

export function Audience() {
  const { t } = useLanguage();
  const auds = [
    ["lpAud1", Store], ["lpAud2", Building2], ["lpAud3", Briefcase], ["lpAud4", Truck], ["lpAud5", Factory],
  ];
  return (
    <section className="border-y border-slate-800/60 bg-slate-900/40" data-testid="lp-audience">
      <div className={sectionCls}>
        <SectionTitle title={t("lpAudTitle")} testid="lp-aud-title" />
        <div className="flex flex-wrap items-center justify-center gap-3 max-w-3xl mx-auto">
          {auds.map(([key, Icon]) => (
            <span key={key} data-testid={`lp-aud-${key}`}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-slate-950/60 border border-slate-700 text-sm font-bold text-slate-200">
              <Icon className="w-4 h-4 text-emerald-400" />
              {t(key)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const { t } = useLanguage();
  const steps = [
    ["1", UserPlus, "lpHow1", "lpHow1d"],
    ["2", PackagePlus, "lpHow2", "lpHow2d"],
    ["3", Rocket, "lpHow3", "lpHow3d"],
  ];
  return (
    <section className={sectionCls} data-testid="lp-how">
      <SectionTitle title={t("lpHowTitle")} testid="lp-how-title" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
        {steps.map(([num, Icon, titleKey, descKey]) => (
          <div key={num} data-testid={`lp-how-step-${num}`} className="relative text-center bg-slate-900/60 border border-slate-800 rounded-2xl p-8">
            <span className="absolute top-4 end-5 text-5xl font-extrabold text-slate-800 select-none" aria-hidden="true">{num}</span>
            <span className="relative w-14 h-14 mx-auto rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-5">
              <Icon className="w-7 h-7 text-emerald-400" />
            </span>
            <h3 className="relative font-bold text-slate-100 mb-2">{t(titleKey)}</h3>
            <p className="relative text-sm text-slate-400 leading-relaxed">{t(descKey)}</p>
          </div>
        ))}
      </div>
      <div className="text-center mt-12">
        <Link to={REGISTER_URL} data-testid="lp-how-cta"
          className="inline-flex px-8 py-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold transition-all shadow-lg shadow-emerald-500/25 hover:-translate-y-0.5">
          {t("lpHowCta")}
        </Link>
      </div>
    </section>
  );
}
