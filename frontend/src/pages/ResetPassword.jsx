import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Lock, Loader2, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useLanguage } from "../context/LanguageContext";
import { AuthShell } from "./ForgotPassword";

const inputCls = "w-full ps-10 pe-4 py-3 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-100 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors placeholder:text-slate-400";

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
          <h1 className="text-xl font-bold text-slate-100 mb-2">{t("resetSuccess")}</h1>
          <Link to="/auth" data-testid="reset-back-login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors mt-2">
            <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("backToLogin")}
          </Link>
        </div>
      ) : invalid ? (
        <div className="text-center" data-testid="reset-invalid">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-100 mb-2">{t("resetLinkInvalid")}</h1>
          <div className="flex flex-col items-center gap-3 mt-5">
            <Link to="/forgot-password" data-testid="reset-request-new" className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors shadow-lg shadow-emerald-600/20">
              {t("requestNewLink")}
            </Link>
            <Link to="/auth" data-testid="reset-back-login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-slate-200 transition-colors">
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("backToLogin")}
            </Link>
          </div>
        </div>
      ) : (
        <>
          <h1 className="text-xl font-bold text-slate-100" data-testid="reset-title">{t("resetTitle")}</h1>
          <p className="text-sm text-slate-400 mt-1 mb-6">{t("resetDesc")}</p>
          <form onSubmit={submit} className="space-y-4" data-testid="reset-form">
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3" />
              <input data-testid="reset-password-input" type="password" required minLength={6} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder={t("newPassword")} className={inputCls} />
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute top-1/2 -translate-y-1/2 start-3" />
              <input data-testid="reset-confirm-input" type="password" required minLength={6} value={confirm}
                onChange={(e) => setConfirm(e.target.value)} placeholder={t("confirmPassword")} className={inputCls} />
            </div>
            {error && <p className="text-xs text-red-400" data-testid="reset-error">{error}</p>}
            <button data-testid="reset-submit-btn" type="submit" disabled={loading}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("resetSubmit")}
            </button>
          </form>
          <p className="text-center mt-6">
            <Link to="/auth" data-testid="reset-back-login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-slate-200 transition-colors">
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("backToLogin")}
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
