import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { TrendingUp, Loader2, X, Languages } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { WelcomeStep, BusinessStep, ProductsStep, OpeningStep, ActionStep, CompleteStep } from "../components/onboarding/steps";

const SKIP_KEYS = { 1: "business", 2: "products", 3: "opening", 4: "first_action" };

export default function Onboarding() {
  const { user, checked } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const navigate = useNavigate();
  const [ob, setOb] = useState(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/onboarding");
      setOb(data);
      setStep(data.step || 0);
    } catch {
      setFailed(true);
    }
  }, []);

  const loadedRef = useRef(false);
  useEffect(() => {
    if (user && !loadedRef.current) {
      loadedRef.current = true;
      load();
    }
  }, [user, load]);

  const save = async (payload) => {
    try {
      const { data } = await api.put("/onboarding", payload);
      setOb(data);
      return data;
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
      return null;
    }
  };

  const goTo = async (n, skipKey) => {
    setBusy(true);
    const payload = { step: n };
    if (skipKey) payload.skip_step = skipKey;
    const res = await save(payload);
    setBusy(false);
    if (res) setStep(n);
  };

  const next = () => goTo(step + 1);
  const skipStep = () => goTo(step + 1, SKIP_KEYS[step]);
  const back = () => goTo(step - 1);

  const endWizard = async (status) => {
    setBusy(true);
    const res = await save({ status, step: status === "completed" ? 5 : step });
    setBusy(false);
    if (res) navigate("/dashboard", { replace: true });
  };

  if (checked && !user) return <Navigate to="/auth" replace />;
  if (user?.business && !user.business.setup_completed) return <Navigate to="/setup" replace />;
  if (ob && !ob.required) return <Navigate to="/dashboard" replace />;
  if (failed) return <Navigate to="/dashboard" replace />;

  const pct = Math.round((step / 5) * 100);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative overflow-hidden" data-testid="onboarding-page">
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 start-1/4 w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-0 end-1/4 w-96 h-96 rounded-full bg-teal-500/10 blur-3xl" />
      </div>

      <header className="relative z-10 w-full max-w-3xl mx-auto flex items-center justify-between gap-4 px-5 pt-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg text-slate-100">{t("appName")}</span>
        </div>
        <div className="flex items-center gap-4">
          <button data-testid="ob-lang-toggle" onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-semibold text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors">
            <Languages className="w-3.5 h-3.5" />
            {lang === "ar" ? "English" : "العربية"}
          </button>
          <div className="hidden sm:block text-end">
            <p className="text-xs font-semibold text-slate-300" data-testid="ob-progress-label">{t("obTitle")}</p>
            <div className="w-32 h-1.5 mt-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${pct}%` }} data-testid="ob-progress-bar" />
            </div>
          </div>
          {step > 0 && step < 5 && (
            <button data-testid="ob-continue-later" onClick={() => navigate("/dashboard")}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors">
              <X className="w-4 h-4" />
              {t("obContinueLater")}
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-10">
        {!ob ? (
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" data-testid="ob-loading" />
        ) : (
          <div key={step} className="w-full max-w-xl bg-slate-900/70 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl shadow-black/40 fade-up" data-testid="ob-card">
            {step === 0 && <WelcomeStep t={t} busy={busy} onStart={next} onSkipAll={() => endWizard("skipped")} />}
            {step === 1 && <BusinessStep t={t} lang={lang} user={user} busy={busy} onNext={next} onBack={back} />}
            {step === 2 && <ProductsStep t={t} busy={busy} onSkip={skipStep} onBack={back} />}
            {step === 3 && <OpeningStep t={t} busy={busy} onSkip={skipStep} onBack={back} />}
            {step === 4 && <ActionStep t={t} busy={busy} onSkip={skipStep} onBack={back} />}
            {step === 5 && <CompleteStep t={t} ob={ob} busy={busy} onFinish={() => endWizard("completed")} />}
          </div>
        )}
      </main>
    </div>
  );
}
