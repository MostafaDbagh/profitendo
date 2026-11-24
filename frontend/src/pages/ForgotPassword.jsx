import {PageHeader, PageContainer} from '../components/page-layout/PageLayout';
import {panelClass, primaryClass} from '../components/page-layout/tokens';
import {inputClass} from '../components/auth-v2/Fields';
import RequiredMark from '../components/RequiredMark';
import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Loader2, ArrowLeft, CheckCircle2, TrendingUp } from "lucide-react";
import api, { formatApiError } from "../lib/api";
import { useLanguage } from "../context/LanguageContext";

const inputCls = `${inputClass} !ps-10`;

export function AuthShell({ children }) {
  return (
    <PageContainer className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-extrabold text-foreground">ProfitLens</span>
        </div>
        <div className={panelClass}>{children}</div>
      </div>
    </PageContainer>
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
          <PageHeader title={t("forgotSentTitle")} heading="h1"/>
          <p className="text-sm text-slate-600 leading-relaxed mb-6">{t("forgotSentDesc")}</p>
          <Link to="/auth" data-testid="forgot-back-login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-900 transition-colors">
            <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("backToLogin")}
          </Link>
        </div>
      ) : (
        <>
          <PageHeader title={t("forgotTitle")} heading="h1" titleTestId="forgot-title"/>
          <p className="text-sm text-slate-600 mt-1 mb-6">{t("forgotDesc")}</p>
          <form onSubmit={submit} className="space-y-4" data-testid="forgot-form">
            <label htmlFor="forgot-email-input" className="block text-sm font-medium text-slate-700">{t("email")}<RequiredMark/></label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3" />
              <input id="forgot-email-input" data-testid="forgot-email-input" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder={t("emailPh")} className={inputCls} dir="ltr" />
            </div>
            {error && <p className="text-xs text-red-700" data-testid="forgot-error">{error}</p>}
            <button data-testid="forgot-submit-btn" type="submit" disabled={loading}
              className={`${primaryClass} w-full`}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("forgotSubmit")}
            </button>
          </form>
          <p className="text-center mt-6">
            <Link to="/auth" data-testid="forgot-back-login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors">
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("backToLogin")}
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
