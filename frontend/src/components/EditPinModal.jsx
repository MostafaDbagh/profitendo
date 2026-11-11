import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Loader2, X, ShieldAlert } from "lucide-react";
import api from "../lib/api";
import { useLanguage } from "../context/LanguageContext";

export default function EditPinModal({ invoiceLabel, mode, onClose, onSuccess }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    try {
      if (mode === "pin") {
        await api.post("/auth/pin/verify", { pin: value });
      } else {
        await api.post("/auth/unlock", { password: value });
      }
      const verified = value;
      setValue("");
      onSuccess(verified);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="edit-pin-modal">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl border border-slate-200 shadow-xl p-6 w-full max-w-sm fade-up">
        <button onClick={onClose} data-testid="edit-pin-close"
          className="absolute top-4 end-4 text-slate-400 hover:text-slate-700 transition-colors">
          <X className="w-4 h-4" />
        </button>

        {mode === "setup" ? (
          <div data-testid="edit-pin-setup-required">
            <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mb-4">
              <ShieldAlert className="w-6 h-6 text-amber-500" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-1">{t("editPinTitle")}</h2>
            <p className="text-sm text-slate-500 mb-5">
              {invoiceLabel && <span className="font-semibold text-slate-700 tabular">{invoiceLabel} — </span>}
              {t("editNoAuthSetup")}
            </p>
            <button data-testid="edit-pin-goto-settings" onClick={() => navigate("/settings")}
              className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors">
              {t("goToSettings")}
            </button>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-emerald-500" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-1">{t("editPinTitle")}</h2>
            <p className="text-sm text-slate-500 mb-5">
              {invoiceLabel && <span className="font-semibold text-slate-700 tabular">{invoiceLabel} — </span>}
              {mode === "pin" ? t("editPinDesc") : t("editPasswordDesc")}
            </p>
            <form onSubmit={submit} className="space-y-4">
              <input
                data-testid="edit-pin-input"
                type="password" autoComplete="off" autoFocus
                inputMode={mode === "pin" ? "numeric" : undefined}
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(false); }}
                placeholder={mode === "pin" ? t("pinEnter") : t("passwordLabel")}
                className={`w-full px-4 py-3 rounded-lg border text-center text-lg focus:ring-2 transition-colors ${
                  mode === "pin" ? "tracking-widest tabular" : ""
                } ${
                  error ? "border-red-300 focus:ring-red-500 focus:border-red-500" : "border-slate-200 focus:ring-emerald-500 focus:border-emerald-500"
                }`}
                dir="ltr"
              />
              {error && (
                <p data-testid="edit-pin-error" className="text-sm text-red-600 font-medium text-center">
                  {mode === "pin" ? t("pinWrong") : t("wrongPasswordMsg")}
                </p>
              )}
              <button data-testid="edit-pin-submit" type="submit"
                disabled={loading || (mode === "pin" ? value.length < 4 : value.length < 1)}
                className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("pinUnlock")}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
