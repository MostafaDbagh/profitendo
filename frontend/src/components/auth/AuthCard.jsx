import { Mail, Lock, User, Loader2, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

const inputCls = "w-full ps-10 pe-4 py-2.5 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors";

const TITLES = { login: "loginTitle", kiosk: "kioskLoginTitle", "owner-setup": "ownerSetupTitle", "kiosk-setup": "setupPasswordTitle", register: "registerTitle" };

function GoogleButton({ testid, onClick, t }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      type="button"
      className="w-full py-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-sm transition-colors duration-150 flex items-center justify-center gap-2"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.96 10.96 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
      {t("googleBtn")}
    </button>
  );
}

function Divider({ t }) {
  return (
    <div className="flex items-center gap-3 my-5">
      <div className="h-px flex-1 bg-slate-200" />
      <span className="text-xs text-slate-400">{t("orDivider")}</span>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

export function AuthCard({ mode, form, set, setForm, setMode, loading, onSubmit, onGoogle, t }) {
  const isSetup = mode === "owner-setup" || mode === "kiosk-setup";
  const subtitle =
    mode === "login" ? t("loginSubtitle")
    : mode === "kiosk" ? t("kioskLoginSubtitle")
    : mode === "owner-setup" ? t("ownerSetupSubtitle")
    : mode === "kiosk-setup" ? t("setupPasswordDesc", { name: form.username })
    : t("registerSubtitle");

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
      <h2 className="text-2xl font-bold text-slate-900" data-testid="auth-title">{t(TITLES[mode])}</h2>
      <p className="text-slate-500 text-sm mt-1 mb-6">{subtitle}</p>

      <form onSubmit={onSubmit} className="space-y-4" data-testid="auth-form">
        {mode === "register" && (
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("name")}</label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input data-testid="auth-name-input" type="text" required value={form.name} onChange={set("name")}
                placeholder={t("namePh")} className={inputCls} />
            </div>
          </div>
        )}
        {mode === "kiosk" || mode === "owner-setup" ? (
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("usernameLabel")}</label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input data-testid="auth-username-input" type="text" required value={form.username} onChange={set("username")}
                placeholder={t("usernameLabel")} className={inputCls} dir="ltr" />
            </div>
          </div>
        ) : mode === "kiosk-setup" ? (
          <p className="text-center text-sm font-semibold text-slate-700" dir="ltr" data-testid="kiosk-setup-username">@{form.username}</p>
        ) : (
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{mode === "register" ? t("email") : t("emailOrUsername")}</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input data-testid="auth-email-input" type={mode === "register" ? "email" : "text"} required value={form.email}
                onChange={set("email")} placeholder={mode === "register" ? t("emailPh") : t("emailOrUsername")}
                className={inputCls} dir="ltr" />
            </div>
          </div>
        )}
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">{isSetup ? t("newPassword") : t("password")}</label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input data-testid="auth-password-input" type="password" required minLength={6} value={form.password}
              onChange={set("password")} placeholder={t("passwordPh")} className={inputCls} />
          </div>
          {mode === "login" && (
            <div className="text-end mt-1.5">
              <Link to="/forgot-password" data-testid="forgot-password-link"
                className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
                {t("forgotLink")}
              </Link>
            </div>
          )}
        </div>
        {isSetup && (
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("confirmPassword")}</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input data-testid="auth-confirm-input" type="password" required minLength={6} value={form.confirm}
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

      {(mode === "login" || mode === "register") && (
        <>
          <Divider t={t} />
          <GoogleButton testid="google-login-btn" onClick={onGoogle} t={t} />
        </>
      )}

      {mode === "owner-setup" && (
        <>
          <Divider t={t} />
          <GoogleButton testid="google-login-btn-setup" onClick={onGoogle} t={t} />
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
    </div>
  );
}
