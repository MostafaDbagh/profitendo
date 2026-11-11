import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Loader2, ArrowLeft, CheckCircle2, TrendingUp } from "lucide-react";
import api, { formatApiError } from "../lib/api";
import { useLanguage } from "../context/LanguageContext";

const inputCls = "w-full ps-10 pe-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-100 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors placeholder:text-slate-400";

export function AuthShell({ children }) {
  return (
    <div className="dark min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center px-4" dir="rtl">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-extrabold text-slate-100">ProfitLens</span>
        </div>
        <div className="bg-slate-800/80 backdrop-blur border border-slate-700/50 rounded-2xl p-8 shadow-xl">{children}</div>
      </div>
    </div>
  );
}

export default function ForgotPassword() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(detail === "RATE_LIMITED" ? t("tooManyAttempts") : formatApiError(err, t("somethingWrong")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      {sent ? (
        <div className="text-center" data-testid="forgot-sent">
          <CheckCircle2 className="w-12 h-12 text-teal-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-100 mb-2">{t("forgotSentTitle")}</h1>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">{t("forgotSentDesc")}</p>
          <Link to="/auth" data-testid="forgot-back-login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
            <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("backToLogin")}
          </Link>
        </div>
      ) : (
        <>
          <h1 className="text-xl font-bold text-slate-100" data-testid="forgot-title">{t("forgotTitle")}</h1>
          <p className="text-sm text-slate-400 mt-1 mb-6">{t("forgotDesc")}</p>
          <form onSubmit={submit} className="space-y-4" data-testid="forgot-form">
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3" />
              <input data-testid="forgot-email-input" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder={t("emailPh")} className={inputCls} dir="ltr" />
            </div>
            {error && <p className="text-xs text-red-400" data-testid="forgot-error">{error}</p>}
            <button data-testid="forgot-submit-btn" type="submit" disabled={loading}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("forgotSubmit")}
            </button>
          </form>
          <p className="text-center mt-6">
            <Link to="/auth" data-testid="forgot-back-login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-slate-200 transition-colors">
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("backToLogin")}
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
