import { useCallback, useEffect, useState } from "react";
import { Lock, Loader2, ArrowLeft, LogOut, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

export default function UserSelect() {
  const { user, checkAuth, setConfirmedFor, logout } = useAuth();
  const { t } = useLanguage();
  const [members, setMembers] = useState(null);
  const [selected, setSelected] = useState(null);
  const [step, setStep] = useState("pick");
  const [value, setValue] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [mode, setMode] = useState("password");
  const [loading, setLoading] = useState(false);
  const pinEnabled = user?.business?.pin_enabled;

  useEffect(() => {
    api.get("/auth/kiosk/users")
      .then(({ data }) => setMembers(data))
      .catch(() => toast.error(t("somethingWrong")));
  }, [t]);

  const pick = useCallback((m) => {
    setSelected(m);
    setValue("");
    setPw1("");
    setPw2("");
    setMode("password");
    setStep(m.has_password ? "auth" : "setup");
  }, []);

  useEffect(() => {
    if (members && members.length === 1 && !selected) pick(members[0]);
  }, [members, selected, pick]);

  const submit = async (e) => {
    e.preventDefault();
    if (!selected || !value) return;
    setLoading(true);
    try {
      await api.post("/auth/switch-user", {
        user_id: selected.user_id,
        ...(mode === "pin" ? { pin: value } : { password: value }),
      });
      await checkAuth();
      setConfirmedFor(selected.user_id);
    } catch (err) {
      if (err?.response?.data?.detail === "PASSWORD_SETUP_REQUIRED") {
        setStep("setup");
      } else {
        toast.error(t("kioskWrong"));
      }
      setValue("");
    } finally {
      setLoading(false);
    }
  };

  const submitSetup = async (e) => {
    e.preventDefault();
    if (!selected || !pw1) return;
    if (pw1 !== pw2) {
      toast.error(t("passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/set-password", { user_id: selected.user_id, password: pw1 });
      toast.success(t("passwordSetSuccess"));
      await checkAuth();
      setConfirmedFor(selected.user_id);
    } catch {
      toast.error(t("somethingWrong"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" data-testid="user-select-screen">
      <div className="w-full max-w-lg fade-up">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl text-slate-900">{t("appName")}</span>
        </div>

        {!selected ? (          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <h1 className="text-2xl font-bold text-slate-900 text-center" data-testid="kiosk-title">{t("kioskTitle")}</h1>
            <p className="text-sm text-slate-500 text-center mt-1 mb-6">{t("kioskSelect")}</p>
            {!members ? (
              <div className="flex justify-center py-8">
                <div className="w-8 h-8 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="kiosk-users">
                {members.map((m) => (
                  <button
                    key={m.user_id}
                    data-testid={`kiosk-user-${m.user_id}`}
                    onClick={() => pick(m)}
                    className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 p-5 hover:border-emerald-400 hover:bg-emerald-50/50 transition-colors"
                  >
                    {m.picture ? (
                      <img src={m.picture} alt="" className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-lg">
                        {(m.name || "U").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="text-sm font-semibold text-slate-800 text-center leading-tight">{m.name}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-6 pt-4 border-t border-slate-100 text-center">
              <button onClick={logout} data-testid="kiosk-logout-btn"
                className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-red-600 transition-colors">
                <LogOut className="w-3.5 h-3.5 rtl:-scale-x-100" /> {t("logout")}
              </button>
            </div>
          </div>
        ) : step === "setup" ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center" data-testid="kiosk-setup-screen">
            <button onClick={() => { setSelected(null); setStep("pick"); }} data-testid="kiosk-setup-back-btn"
              className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-700 transition-colors mb-4">
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("back")}
            </button>
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-2xl mx-auto mb-3">
              {selected.picture ? (
                <img src={selected.picture} alt="" className="w-16 h-16 rounded-full object-cover" />
              ) : (
                (selected.name || "U").charAt(0).toUpperCase()
              )}
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-1" data-testid="kiosk-setup-title">{t("setupPasswordTitle")}</h2>
            <p className="text-sm text-slate-500 mb-6">{t("setupPasswordDesc", { name: selected.name })}</p>
            <form onSubmit={submitSetup} className="space-y-4">
              <input
                data-testid="kiosk-setup-password-input"
                type="password"
                autoComplete="new-password"
                autoFocus
                placeholder={t("newPassword")}
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-slate-200 text-center text-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
              />
              <input
                data-testid="kiosk-setup-confirm-input"
                type="password"
                autoComplete="new-password"
                placeholder={t("confirmPassword")}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-slate-200 text-center text-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
              />
              <button
                data-testid="kiosk-setup-submit-btn"
                type="submit"
                disabled={loading || !pw1 || !pw2}
                className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                {t("kioskContinue")}
              </button>
            </form>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center" data-testid="kiosk-credential-screen">
            <button onClick={() => { setSelected(null); setStep("pick"); }} data-testid="kiosk-back-btn"
              className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-700 transition-colors mb-4">
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" /> {t("back")}
            </button>
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-2xl mx-auto mb-3">
              {selected.picture ? (
                <img src={selected.picture} alt="" className="w-16 h-16 rounded-full object-cover" />
              ) : (
                (selected.name || "U").charAt(0).toUpperCase()
              )}
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-1" data-testid="kiosk-selected-name">{selected.name}</h2>
            <p className="text-sm text-slate-500 mb-6">{mode === "pin" ? t("pinEnter") : t("kioskPasswordFor")}</p>
            <form onSubmit={submit} className="space-y-4">
              <input
                data-testid="kiosk-credential-input"
                type="password"
                inputMode={mode === "pin" ? "numeric" : "text"}
                autoComplete="off"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-slate-200 text-center text-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                dir={mode === "pin" ? "ltr" : undefined}
              />
              <button
                data-testid="kiosk-continue-btn"
                type="submit"
                disabled={loading || !value}
                className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                {t("kioskContinue")}
              </button>
            </form>
            {pinEnabled && selected.has_password && (
              <button
                data-testid="kiosk-switch-mode"
                onClick={() => { setMode(mode === "pin" ? "password" : "pin"); setValue(""); }}
                className="mt-4 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
              >
                {mode === "pin" ? t("unlockWithPassword") : t("unlockWithPin")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
