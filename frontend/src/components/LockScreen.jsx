import { useState } from "react";
import { Lock, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";

export default function LockScreen({ onUnlock }) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const pinEnabled = user?.business?.pin_enabled;
  const [mode, setMode] = useState(pinEnabled ? "pin" : "password");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/unlock", mode === "pin" ? { pin: value } : { password: value });
      setValue("");
      onUnlock();
    } catch {
      toast.error(t("unlockFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-6" data-testid="lock-screen">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8 text-center fade-up">
        <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-2xl mx-auto mb-4">
          {(user?.name || "U").charAt(0).toUpperCase()}
        </div>
        <h2 className="text-xl font-bold text-slate-900" data-testid="lock-greeting">
          {t("greeting", { name: user?.name || "" })}
        </h2>
        <p className="text-sm text-slate-500 mt-1 mb-6">{t("lockDesc")}</p>
        <form onSubmit={submit} className="space-y-4">
          <input
            data-testid="lock-input"
            type="password"
            inputMode={mode === "pin" ? "numeric" : "text"}
            autoComplete="off"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={mode === "pin" ? t("pinEnter") : t("password")}
            className="w-full px-4 py-3 rounded-lg border border-slate-200 text-center text-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
            dir={mode === "pin" ? "ltr" : undefined}
          />
          <button
            data-testid="lock-unlock-btn"
            type="submit"
            disabled={loading || !value}
            className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {t("unlockBtn")}
          </button>
        </form>
        {pinEnabled && (
          <button
            data-testid="lock-switch-mode"
            onClick={() => { setMode(mode === "pin" ? "password" : "pin"); setValue(""); }}
            className="mt-4 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
          >
            {mode === "pin" ? t("unlockWithPassword") : t("unlockWithPin")}
          </button>
        )}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <button onClick={logout} data-testid="lock-logout-btn"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-red-600 transition-colors">
            <LogOut className="w-3.5 h-3.5 rtl:-scale-x-100" /> {t("logout")}
          </button>
        </div>
      </div>
    </div>
  );
}
