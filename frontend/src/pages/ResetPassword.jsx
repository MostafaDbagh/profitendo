import {PageHeader} from '../components/page-layout/PageLayout';
import {primaryClass} from '../components/page-layout/tokens';
import {inputClass} from '../components/auth-v2/Fields';
import RequiredMark from '../components/RequiredMark';
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Lock, Loader2, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useLanguage } from "../context/LanguageContext";
import { AuthShell } from "./ForgotPassword";

const inputCls = `${inputClass} !ps-10`;

export default function ResetPassword() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(!token);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) return setError(t("passwordTooShort"));
    if (password !== confirm) return setError(t("passwordMismatch"));
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: password });
      setDone(true);
      toast.success(t("resetSuccess"));
      setTimeout(() => navigate("/auth"), 2500);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (detail === "RESET_LINK_INVALID" || detail === "RESET_LINK_EXPIRED") {
        setInvalid(true);
      } else {
        setError(t("somethingWrong"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      {done ? (
        <div className="text-center" data-testid="reset-success">
          <CheckCircle2 className="w-12 h-12 text-teal-400 mx-auto mb-4" />
          <PageHeader title={t("resetSuccess")} heading="h1"/>
          <Link to="/auth" data-testid="reset-back-login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-900 transition-colors mt-2">
            <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("backToLogin")}
          </Link>
        </div>
      ) : invalid ? (
        <div className="text-center" data-testid="reset-invalid">
          <XCircle className="w-12 h-12 text-red-700 mx-auto mb-4" />
          <PageHeader title={t("resetLinkInvalid")} heading="h1"/>
          <div className="flex flex-col items-center gap-3 mt-5">
            <Link to="/forgot-password" data-testid="reset-request-new" className={primaryClass}>
              {t("requestNewLink")}
            </Link>
            <Link to="/auth" data-testid="reset-back-login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors">
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("backToLogin")}
            </Link>
          </div>
        </div>
      ) : (
        <>
          <PageHeader title={t("resetTitle")} heading="h1" titleTestId="reset-title"/>
          <p className="text-sm text-slate-600 mt-1 mb-6">{t("resetDesc")}</p>
          <form onSubmit={submit} className="space-y-4" data-testid="reset-form">
            <label htmlFor="reset-password-input" className="block text-sm font-medium text-slate-700">{t("newPassword")}<RequiredMark/></label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3" />
              <input id="reset-password-input" data-testid="reset-password-input" type="password" required minLength={6} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder={t("newPassword")} className={inputCls} />
            </div>
            <label htmlFor="reset-confirm-input" className="block text-sm font-medium text-slate-700">{t("confirmPassword")}<RequiredMark/></label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3" />
              <input id="reset-confirm-input" data-testid="reset-confirm-input" type="password" required minLength={6} value={confirm}
                onChange={(e) => setConfirm(e.target.value)} placeholder={t("confirmPassword")} className={inputCls} />
            </div>
            {error && <p className="text-xs text-red-700" data-testid="reset-error">{error}</p>}
            <button data-testid="reset-submit-btn" type="submit" disabled={loading}
              className={`${primaryClass} w-full`}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("resetSubmit")}
            </button>
          </form>
          <p className="text-center mt-6">
            <Link to="/auth" data-testid="reset-back-login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors">
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("backToLogin")}
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
