import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, PackagePlus, FileUp, Wallet, ShoppingCart, ShoppingBag, Receipt,
  CheckCircle2, Circle, MinusCircle, ArrowLeft, ArrowRight, Loader2, PartyPopper,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { COUNTRIES, CURRENCY_OPTIONS, CURRENCY_LABELS, countryByCode, countryName } from "../../lib/locale";

const inputCls = "w-full px-4 py-2.5 rounded-lg border border-slate-700 bg-slate-800/60 text-sm text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors";
const primaryBtn = "w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2";
const ghostBtn = "text-sm text-slate-400 hover:text-slate-200 transition-colors";
const BUSINESS_TYPES = ["retail", "ecommerce", "services", "food", "wholesale", "other"];

function StepHeader({ title, sub, testid }) {
  return (
    <div className="text-center mb-8">
      <h2 className="text-2xl font-bold text-slate-100" data-testid={testid}>{title}</h2>
      {sub && <p className="text-slate-400 text-sm mt-2 leading-relaxed">{sub}</p>}
    </div>
  );
}

function OptionCard({ icon: Icon, label, onClick, testid, primary }) {
  return (
    <button onClick={onClick} data-testid={testid}
      className={`w-full flex items-center gap-4 px-5 py-4 rounded-xl border text-start font-semibold text-sm transition-all duration-150 ${
        primary
          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20"
          : "bg-slate-800/50 border-slate-700 text-slate-200 hover:border-slate-500 hover:bg-slate-800"
      }`}>
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${primary ? "bg-emerald-500 text-white" : "bg-slate-700/60 text-slate-300"}`}>
        <Icon className="w-5 h-5" />
      </span>
      {label}
    </button>
  );
}

export function WelcomeStep({ t, busy, onStart, onSkipAll }) {
  return (
    <div className="text-center space-y-8" data-testid="ob-welcome">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
        <Sparkles className="w-8 h-8 text-emerald-400" />
      </div>
      <div>
        <h1 className="text-3xl font-bold text-slate-100" data-testid="ob-welcome-title">{t("obWelcomeTitle")}</h1>
        <p className="text-slate-400 mt-3">{t("obWelcomeSub")}</p>
      </div>
      <div className="space-y-4">
        <button data-testid="ob-welcome-start" onClick={onStart} disabled={busy} className={primaryBtn}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {t("obStart")}
        </button>
        <button data-testid="ob-welcome-skip" onClick={onSkipAll} disabled={busy} className={ghostBtn}>{t("obSkipNow")}</button>
      </div>
    </div>
  );
}

export function BusinessStep({ t, lang, user, busy, onNext, onBack }) {
  const { checkAuth } = useAuth();
  const b = user?.business || {};
  const [form, setForm] = useState({
    name: b.name || "",
    business_type: b.business_type || "other",
    country: b.country || "XX",
    base_currency: b.base_currency || "USD",
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api.put("/business", form);
      await checkAuth();
      onNext();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="ob-business">
      <StepHeader title={t("obBizStep")} sub={t("obBizStepSub")} testid="ob-biz-title" />
      <form onSubmit={submit} className="space-y-4" data-testid="ob-biz-form">
        <div>
          <label className="text-sm font-medium text-slate-300 mb-1.5 block">{t("bizName")}</label>
          <input data-testid="ob-biz-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required className={inputCls} />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-300 mb-1.5 block">{t("obBizType")}</label>
          <select data-testid="ob-biz-type" value={form.business_type} onChange={(e) => setForm((f) => ({ ...f, business_type: e.target.value }))} className={inputCls}>
            {BUSINESS_TYPES.map((bt) => <option key={bt} value={bt} data-testid={`ob-type-${bt}`}>{t(`obType_${bt}`)}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-300 mb-1.5 block">{t("countryLabel")}</label>
            <select data-testid="ob-biz-country" value={form.country}
              onChange={(e) => {
                const c = countryByCode(e.target.value);
                setForm((f) => ({ ...f, country: e.target.value, base_currency: c ? c.currency : f.base_currency }));
              }} className={inputCls}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{countryName(c, lang)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-300 mb-1.5 block">{t("bizCurrency")}</label>
            <select data-testid="ob-biz-currency" value={form.base_currency} onChange={(e) => setForm((f) => ({ ...f, base_currency: e.target.value }))} className={inputCls}>
              {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{CURRENCY_LABELS[lang]?.[c] || c}</option>)}
            </select>
          </div>
        </div>
        <button data-testid="ob-biz-save" type="submit" disabled={saving || busy || !form.name.trim()} className={primaryBtn}>
          {(saving || busy) && <Loader2 className="w-4 h-4 animate-spin" />}
          {t("obSaveContinue")}
        </button>
        <div className="text-center">
          <button type="button" data-testid="ob-biz-back" onClick={onBack} disabled={busy} className={ghostBtn}>{t("obBack")}</button>
        </div>
      </form>
    </div>
  );
}

export function ProductsStep({ t, busy, onSkip, onBack }) {
  const navigate = useNavigate();
  return (
    <div data-testid="ob-products">
      <StepHeader title={t("obProductsStep")} sub={t("obProductsStepSub")} testid="ob-products-title" />
      <div className="space-y-3">
        <OptionCard icon={PackagePlus} label={t("obAddProduct")} primary testid="ob-products-add" onClick={() => navigate("/products/new?onboarding=1")} />
        <OptionCard icon={FileUp} label={t("obImportProducts")} testid="ob-products-import" onClick={() => navigate("/products?import=1&onboarding=1")} />
      </div>
      <div className="flex items-center justify-between mt-6">
        <button data-testid="ob-products-back" onClick={onBack} disabled={busy} className={ghostBtn}>{t("obBack")}</button>
        <button data-testid="ob-products-skip" onClick={onSkip} disabled={busy} className={ghostBtn}>{t("obSkipNow")}</button>
      </div>
    </div>
  );
}

export function OpeningStep({ t, busy, onSkip, onBack }) {
  const navigate = useNavigate();
  return (
    <div data-testid="ob-opening">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center mb-6">
        <Wallet className="w-7 h-7 text-teal-400" />
      </div>
      <StepHeader title={t("obOpeningStep")} sub={t("obOpeningDesc")} testid="ob-opening-title" />
      <button data-testid="ob-opening-setup" onClick={() => navigate("/settings?onboarding=1")} disabled={busy} className={primaryBtn}>
        {t("obSetOpening")}
      </button>
      <div className="flex items-center justify-between mt-6">
        <button data-testid="ob-opening-back" onClick={onBack} disabled={busy} className={ghostBtn}>{t("obBack")}</button>
        <button data-testid="ob-opening-skip" onClick={onSkip} disabled={busy} className={ghostBtn}>{t("obSkipNow")}</button>
      </div>
    </div>
  );
}

export function ActionStep({ t, busy, onSkip, onBack }) {
  const navigate = useNavigate();
  return (
    <div data-testid="ob-action">
      <StepHeader title={t("obActionStep")} sub={t("obActionStepSub")} testid="ob-action-title" />
      <div className="space-y-3">
        <OptionCard icon={ShoppingCart} label={t("obFirstSale")} primary testid="ob-action-sale" onClick={() => navigate("/sales/new?onboarding=1")} />
        <OptionCard icon={ShoppingBag} label={t("obFirstPurchase")} testid="ob-action-purchase" onClick={() => navigate("/purchases/new?onboarding=1")} />
        <OptionCard icon={Receipt} label={t("obFirstExpense")} testid="ob-action-expense" onClick={() => navigate("/expenses?new=1&onboarding=1")} />
      </div>
      <div className="flex items-center justify-between mt-6">
        <button data-testid="ob-action-back" onClick={onBack} disabled={busy} className={ghostBtn}>{t("obBack")}</button>
        <button data-testid="ob-action-skip" onClick={onSkip} disabled={busy} className={ghostBtn}>{t("obSkipNow")}</button>
      </div>
    </div>
  );
}

export function CompleteStep({ t, ob, busy, onFinish }) {
  const checklist = ob?.checklist || {};
  const skipped = ob?.skipped_steps || [];
  const items = [
    ["business", t("obChkBusiness")],
    ["products", t("obChkProducts")],
    ["opening", t("obChkOpening")],
    ["first_transaction", t("obChkFirstTx")],
  ];
  return (
    <div className="text-center space-y-8" data-testid="ob-complete">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
        <PartyPopper className="w-8 h-8 text-emerald-400" />
      </div>
      <div>
        <h1 className="text-3xl font-bold text-slate-100" data-testid="ob-complete-title">{t("obCompleteTitle")}</h1>
        <p className="text-slate-400 mt-3">{t("obCompleteSub")}</p>
      </div>
      <ul className="space-y-2.5 text-start" data-testid="ob-complete-checklist">
        {items.map(([key, label]) => {
          const done = !!checklist[key];
          const wasSkipped = skipped.includes(key);
          const Icon = done ? CheckCircle2 : wasSkipped ? MinusCircle : Circle;
          const tone = done ? "text-emerald-400" : wasSkipped ? "text-amber-400" : "text-slate-500";
          const status = done ? t("obDoneStatus") : wasSkipped ? t("obSkipped") : t("obPendingStatus");
          return (
            <li key={key} data-testid={`ob-check-${key}`}
              className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700">
              <span className="flex items-center gap-3 text-sm font-medium text-slate-200">
                <Icon className={`w-5 h-5 ${tone}`} />
                {label}
              </span>
              <span className={`text-xs font-bold ${tone}`}>{status}</span>
            </li>
          );
        })}
      </ul>
      <button data-testid="ob-finish-btn" onClick={onFinish} disabled={busy} className={primaryBtn}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {t("obGoDashboard")}
        <ArrowRight className="w-4 h-4 rtl:-scale-x-100" />
      </button>
    </div>
  );
}
