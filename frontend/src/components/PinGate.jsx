import { useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { setPinToken } from "../lib/api";
import { useLanguage } from "../context/LanguageContext";

export default function PinGate({ onSuccess, testid = "pin-gate" }) {
  const { t } = useLanguage();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/pin/verify", { pin });
      setPinToken(data.pin_token);
      setPin("");
      onSuccess();
    } catch {
      toast.error(t("pinWrong"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto py-12" data-testid={testid}>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-7 h-7 text-emerald-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">{t("pinRequiredTitle")}</h2>
        <p className="text-sm text-slate-500 mb-6">{t("pinRequiredDesc")}</p>
        <form onSubmit={submit} className="space-y-4">
          <input
            data-testid="pin-gate-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder={t("pinEnter")}
            className="w-full px-4 py-3 rounded-lg border border-slate-200 text-center text-lg tracking-widest tabular focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
            dir="ltr"
          />
          <button
            data-testid="pin-gate-submit"
            type="submit"
            disabled={loading || pin.length < 4}
            className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("pinUnlock")}
          </button>
        </form>
      </div>
    </div>
  );
}
