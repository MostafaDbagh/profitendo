import {PageLayout} from '../page-layout/PageLayout';
import {panelClass} from '../page-layout/tokens';
import RequiredMark from '../RequiredMark';
import { Mail, Lock, User, Loader2, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

const inputCls = "auth-icon-input w-full py-2.5 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors";

const TITLES = { login: "loginTitle", kiosk: "kioskLoginTitle", "owner-setup": "ownerSetupTitle", "kiosk-setup": "setupPasswordTitle", register: "registerTitle" };

export function AuthCard({ mode, form, set, setForm, setMode, loading, onSubmit, t }) {
  const isSetup = mode === "owner-setup" || mode === "kiosk-setup";
  return (
    <PageLayout className={panelClass} title={t(TITLES[mode])} heading="h1" titleTestId="auth-title">
      {mode==='kiosk-setup'&&<p className="text-sm text-slate-600">{t("setupPasswordDesc",{name:form.username})}</p>}
      <form onSubmit={onSubmit} className="space-y-4" data-testid="auth-form">
        {mode === "register" && (
          <div>
            <label htmlFor="auth-name-input" className="text-sm font-medium text-slate-700 mb-1.5 block">{t("name")}<RequiredMark/></label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input id="auth-name-input" data-testid="auth-name-input" type="text" required value={form.name} onChange={set("name")}
                placeholder={t("namePh")} className={inputCls} />
            </div>
          </div>
        )}
        {mode === "kiosk" || mode === "owner-setup" ? (
          <div>
            <label htmlFor="auth-username-input" className="text-sm font-medium text-slate-700 mb-1.5 block">{t("usernameLabel")}<RequiredMark/></label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input id="auth-username-input" data-testid="auth-username-input" type="text" required value={form.username} onChange={set("username")}
                placeholder={t("usernameLabel")} className={inputCls} dir="ltr" />
            </div>
          </div>
        ) : mode === "kiosk-setup" ? (
          <p className="text-center text-sm font-semibold text-slate-700" dir="ltr" data-testid="kiosk-setup-username">@{form.username}</p>
        ) : (
          <div>
            <label htmlFor="auth-email-input" className="text-sm font-medium text-slate-700 mb-1.5 block">{mode === "register" ? t("email") : t("emailOrUsername")}<RequiredMark/></label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input id="auth-email-input" data-testid="auth-email-input" type={mode === "register" ? "email" : "text"} required value={form.email}
                onChange={set("email")} placeholder={mode === "register" ? t("emailPh") : t("emailOrUsername")}
                className={inputCls} dir="ltr" />
            </div>
          </div>
        )}
        <div>
          <label htmlFor="auth-password-input" className="text-sm font-medium text-slate-700 mb-1.5 block">{isSetup ? t("newPassword") : t("password")}<RequiredMark/></label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input id="auth-password-input" data-testid="auth-password-input" type="password" required minLength={6} value={form.password}
              onChange={set("password")} placeholder={t("passwordPh")} className={inputCls} />
          </div>
          {mode === "login" && (
            <div className="text-end rtl:text-start mt-1.5">
              <Link to="/forgot-password" data-testid="forgot-password-link"
                className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
                {t("forgotLink")}
              </Link>
            </div>
          )}
        </div>
        {isSetup && (
          <div>
            <label htmlFor="auth-confirm-input" className="text-sm font-medium text-slate-700 mb-1.5 block">{t("confirmPassword")}<RequiredMark/></label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input id="auth-confirm-input" data-testid="auth-confirm-input" type="password" required minLength={6} value={form.confirm}
                onChange={set("confirm")} placeholder={t("confirmPassword")} className={inputCls} />
            </div>
          </div>
        )}
        <button
          data-testid="auth-submit-btn"
          type="submit"
          disabled={loading || (isSetup && (!form.password || !form.confirm)) || (mode === "owner-setup" && !form.username)}
          className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors duration-150 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {mode === "login" ? t("login") : mode === "kiosk" ? t("kioskContinue") : isSetup ? t("setupSaveBtn") : t("register")}
        </button>
      </form>

      {mode === "owner-setup" && (
        <>
          <p className="text-sm text-slate-500 text-center mt-4">
            <button data-testid="setup-to-login-link" onClick={() => setMode("login")}
              className="text-emerald-600 font-semibold hover:text-emerald-700 transition-colors">
              {t("haveAccount")} {t("login")}
            </button>
          </p>
        </>
      )}

      {(mode === "login" || mode === "kiosk") && (
        <p className="text-sm text-slate-500 text-center mt-6">
          <button data-testid="auth-kiosk-switch" onClick={() => setMode(mode === "kiosk" ? "login" : "kiosk")}
            className="text-emerald-600 font-semibold hover:text-emerald-700 transition-colors">
            {mode === "kiosk" ? t("emailLoginLink") : t("kioskLoginLink")}
          </button>
        </p>
      )}

      {mode === "kiosk-setup" && (
        <p className="text-sm text-slate-500 text-center mt-6">
          <button data-testid="kiosk-setup-back"
            onClick={() => { setMode("kiosk"); setForm((f) => ({ ...f, password: "", confirm: "" })); }}
            className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-700 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5 rtl:-scale-x-100" /> {t("back")}
          </button>
        </p>
      )}

      {(mode === "login" || mode === "register") && (
        <p className="text-sm text-slate-500 text-center mt-3">
          {mode === "login" ? t("noAccount") : t("haveAccount")}{" "}
          <button data-testid="auth-mode-switch" onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="text-emerald-600 font-semibold hover:text-emerald-700 transition-colors">
            {mode === "login" ? t("register") : t("login")}
          </button>
        </p>
      )}
    </PageLayout>
  );
}
