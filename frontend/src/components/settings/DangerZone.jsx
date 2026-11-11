import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { useLanguage } from "../../context/LanguageContext";

const PHRASE = "DELETE ALL DATA";

export function DangerZone() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);

  const resetModal = () => {
    setOpen(false);
    setStep(1);
    setPhrase("");
  };

  const execute = async () => {
    setBusy(true);
    try {
      await api.delete("/business/data", { data: { confirmation: PHRASE } });
      toast.success(t("dataDeleted"));
      resetModal();
      navigate("/dashboard");
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl border-2 border-rose-200 shadow-sm p-6" data-testid="danger-zone-card">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="w-5 h-5 text-rose-500" />
          <h3 className="font-bold text-rose-700">{t("dangerZone")}</h3>
        </div>
        <p className="text-sm text-slate-500 mb-1">{t("deleteAllDataDesc")}</p>
        <p className="text-xs text-slate-400 mb-4">{t("dangerBackupHint")}</p>
        <button onClick={() => setOpen(true)} data-testid="danger-delete-btn"
          className="px-5 py-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm transition-colors">
          {t("deleteAllData")}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" data-testid="danger-modal">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-11 h-11 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-rose-600" />
              </span>
              <h3 className="font-extrabold text-slate-900" data-testid="danger-modal-title">
                {step === 1 ? t("dangerModalTitle") : t("dangerFinalTitle")}
              </h3>
            </div>

            {step === 1 ? (
              <>
                <p className="text-sm text-slate-600 leading-relaxed mb-4">{t("dangerModalDesc")}</p>
                <label className="text-xs font-bold text-slate-500 block mb-1.5">{t("dangerPhraseLabel")}</label>
                <input
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  dir="ltr"
                  placeholder={PHRASE}
                  data-testid="danger-phrase-input"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-rose-500 focus:border-rose-500 mb-5"
                />
                <div className="flex gap-3">
                  <button onClick={resetModal} data-testid="danger-cancel-btn"
                    className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-600 font-bold text-sm hover:bg-slate-50 transition-colors">
                    {t("cancel")}
                  </button>
                  <button
                    onClick={() => setStep(2)}
                    disabled={phrase !== PHRASE}
                    data-testid="danger-continue-btn"
                    className="flex-1 py-2.5 rounded-lg bg-rose-600 text-white font-bold text-sm hover:bg-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {t("dangerContinue")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600 leading-relaxed mb-6">{t("dangerFinalDesc")}</p>
                <div className="flex gap-3">
                  <button onClick={resetModal} disabled={busy} data-testid="danger-cancel-final-btn"
                    className="flex-1 py-2.5 rounded-lg border border-slate-300 text-slate-600 font-bold text-sm hover:bg-slate-50 transition-colors">
                    {t("cancel")}
                  </button>
                  <button onClick={execute} disabled={busy} data-testid="danger-final-btn"
                    className="flex-1 py-2.5 rounded-lg bg-rose-600 text-white font-bold text-sm hover:bg-rose-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                    {busy ? t("deleting") : t("dangerConfirm")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
