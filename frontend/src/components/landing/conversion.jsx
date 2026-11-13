import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, ShieldCheck, Lock, Users, BookOpenCheck, HardDriveDownload, CreditCard, MessageCircle, Mail } from "lucide-react";
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

export function Pricing({ headingLevel = "h2" }) {
  const { t } = useLanguage();
  const plans = [
    {
      key: "free", testid: "lp-plan-free", name: t("lpPlanFree"), price: t("lpPlanFreePrice"), period: t("lpTrialPeriod"),
      features: ["lpFree1", "lpFree2", "lpFree3", "lpFree4"], cta: t("lpStartFree"), ctaTestid: "lp-cta-free", highlight: false,
    },
    {
      key: "premium", testid: "lp-plan-premium", name: t("lpPlanPremium"), price: "$29", period: t("perMonth"),
      features: ["lpFree1", "lpFree2", "lpFree3"], cta: t("lpStartPremium"), ctaTestid: "lp-cta-premium", highlight: false,
    },
    {
      key: "annual", testid: "lp-plan-annual", name: t("lpPlanAnnual"), price: "$99", period: t("lpAnnualFirstYear"),
      renewal: t("lpAnnualRenewal"), features: ["lpFree1", "lpFree2", "lpFree3"], cta: t("lpStartPremium"), ctaTestid: "lp-cta-annual",
      highlight: true, badge: t("lpBestValue"),
    },
  ];
  return (
    <section id="pricing" className={`border-y border-slate-800/60 bg-slate-900/40`} data-testid="lp-pricing">
      <div className={sectionCls}>
        <SectionTitle headingLevel={headingLevel} title={t("lpPriceTitle")} sub={t("lpPriceSub")} testid="lp-price-title" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {plans.map((p) => (
            <div key={p.key} data-testid={p.testid}
              className={`relative rounded-3xl p-8 flex flex-col border transition-all duration-200 ${
                p.highlight
                  ? "bg-gradient-to-b from-emerald-500/15 to-slate-900/60 border-emerald-500/50 shadow-2xl shadow-emerald-500/10 md:-translate-y-2"
                  : "bg-slate-950/60 border-slate-800"
              }`}>
              {p.badge && (
                <span data-testid={`${p.testid}-badge`}
                  className="absolute -top-3.5 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-4 py-1 rounded-full bg-emerald-500 text-white text-xs font-extrabold whitespace-nowrap">
                  {p.badge}
                </span>
              )}
              <h3 className="font-extrabold text-lg text-slate-100 mb-4">{p.name}</h3>
              <p className="mb-1">
                <span className="text-4xl font-extrabold text-white tabular" dir="ltr">{p.price}</span>
                {p.period && <span className="text-sm text-slate-400 ms-1">{p.period}</span>}
              </p>
              {p.renewal && <p className="text-xs text-slate-500 mb-2">{p.renewal}</p>}
              <ul className="space-y-3 my-6 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    {t(f)}
                  </li>
                ))}
              </ul>
              <Link to={REGISTER_URL} data-testid={p.ctaTestid}
                className={`block text-center py-3.5 rounded-xl font-extrabold text-sm transition-colors ${
                  p.highlight
                    ? "bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/25"
                    : "bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
                }`}>
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Security() {
  const { t } = useLanguage();
  const items = [
    ["lpSec1", Lock], ["lpSec2", Users], ["lpSec3", BookOpenCheck], ["lpSec4", HardDriveDownload], ["lpSec5", CreditCard],
  ];
  return (
    <section className={sectionCls} data-testid="lp-security">
      <div className="flex items-center justify-center gap-3 mb-10">
        <ShieldCheck className="w-8 h-8 text-emerald-400" />
        <h2 className="text-3xl font-extrabold text-slate-100" data-testid="lp-sec-title">{t("lpSecTitle")}</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {items.map(([key, Icon], i) => (
          <div key={key} data-testid={`lp-sec-${i + 1}`} className="text-center bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
            <Icon className="w-6 h-6 text-emerald-400 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-300 leading-relaxed">{t(key)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Faq() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(null);
  return (
    <section id="faq" className="border-y border-slate-800/60 bg-slate-900/40" data-testid="lp-faq">
      <div className={`${sectionCls} max-w-3xl`}>
        <SectionTitle title={t("lpFaqTitle")} testid="lp-faq-title" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
            <div key={n} data-testid={`lp-faq-item-${n}`} className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
              <button onClick={() => setOpen(open === n ? null : n)} data-testid={`lp-faq-q-${n}`}
                aria-expanded={open === n} aria-controls={`faq-answer-${n}`}
                className="w-full flex items-center justify-between gap-4 px-6 py-4 text-start font-bold text-slate-100 hover:bg-slate-800/40 transition-colors">
                {t(`lpFaq${n}Q`)}
                <ChevronDown className={`w-5 h-5 text-emerald-400 shrink-0 transition-transform duration-200 ${open === n ? "rotate-180" : ""}`} />
              </button>
              {open === n && (
                <p id={`faq-answer-${n}`} className="px-6 pb-5 text-sm text-slate-400 leading-relaxed" data-testid={`lp-faq-a-${n}`}>{t(`lpFaq${n}A`)}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Support() {
  const { t } = useLanguage();
  return (
    <section className={sectionCls} data-testid="lp-support">
      <SectionTitle title={t("lpSupportTitle")} sub={t("lpSupportSub")} testid="lp-support-title" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-2xl mx-auto">
        <a href="https://wa.me/963985566918" target="_blank" rel="noreferrer" data-testid="lp-whatsapp-link"
          className="flex items-center gap-4 bg-slate-900/60 border border-slate-800 rounded-2xl p-6 hover:border-emerald-500/50 hover:-translate-y-1 transition-all">
          <span className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <MessageCircle className="w-6 h-6 text-emerald-400" />
          </span>
          <span>
            <span className="block font-bold text-slate-100">{t("lpWhats")}</span>
            <span className="block text-sm text-slate-400 mt-0.5" dir="ltr">+963 985 566 918</span>
          </span>
        </a>
        <a href="mailto:profitlens.team@gmail.com" data-testid="lp-email-link"
          className="flex items-center gap-4 bg-slate-900/60 border border-slate-800 rounded-2xl p-6 hover:border-emerald-500/50 hover:-translate-y-1 transition-all">
          <span className="w-12 h-12 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
            <Mail className="w-6 h-6 text-sky-400" />
          </span>
          <span>
            <span className="block font-bold text-slate-100">{t("lpEmail")}</span>
            <span className="block text-sm text-slate-400 mt-0.5" dir="ltr">profitlens.team@gmail.com</span>
          </span>
        </a>
      </div>
    </section>
  );
}

export function FinalCta() {
  const { t, lang } = useLanguage();
  return (
    <section data-testid="lp-final">
      <div className="final-cta-layout">
        <div className="final-cta-copy">
          <h2 data-testid="lp-final-title">{t("lpFinalTitle")}</h2>
          <p data-testid="lp-final-sub">{t("lpFinalSub")}</p>
        </div>
        <div className="final-cta-action">
          <Link to={REGISTER_URL} data-testid="lp-final-cta" className="home-primary">
            {lang === 'ar' ? 'جرّب مجانًا لمدة 14 يومًا' : 'Try free for 14 days'}
          </Link>
          <p><Check size={15} aria-hidden="true"/>{lang === 'ar' ? 'بدون بطاقة بنكية' : 'No credit card required'}</p>
        </div>
      </div>
    </section>
  );
}
