import { useEffect, useState } from "react";
import { WifiOff, Download, RefreshCw, X, Share, PlusSquare } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { useOnlineStatus, isIos, isStandalone, installDismissed, dismissInstall } from "../lib/pwa";

export function OfflineBanner() {
  const online = useOnlineStatus();
  const { t } = useLanguage();
  if (online) return null;
  return (
    <div data-testid="offline-banner"
      className="fixed bottom-0 inset-x-0 z-[90] bg-amber-500 text-slate-950 px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-bold shadow-lg">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>{t("pwaOffline")}</span>
      <span className="hidden sm:inline font-medium opacity-80">— {t("pwaOfflineSub")}</span>
    </div>
  );
}

export function UpdateBanner({ registration, onDone }) {
  const { t } = useLanguage();
  const [reloadArmed, setReloadArmed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let reloaded = false;
    const onCtrl = () => {
      if (reloaded || !reloadArmed) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onCtrl);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onCtrl);
  }, [reloadArmed]);

  const refresh = () => {
    setReloadArmed(true);
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    } else {
      window.location.reload();
    }
  };

  return (
    <div data-testid="pwa-update-banner"
      className="fixed top-0 inset-x-0 z-[90] bg-emerald-600 text-white px-4 py-2.5 flex flex-wrap items-center justify-center gap-3 text-sm font-bold shadow-lg">
      <RefreshCw className="w-4 h-4" />
      <span>{t("pwaUpdateTitle")}</span>
      <button onClick={refresh} data-testid="pwa-update-btn"
        className="px-4 py-1 rounded-lg bg-white text-emerald-700 text-xs font-extrabold hover:bg-emerald-50 transition-colors">
        {t("pwaUpdateBtn")}
      </button>
      <button onClick={onDone} data-testid="pwa-update-later" className="text-xs text-emerald-100 hover:text-white underline underline-offset-2">
        {t("pwaLater")}
      </button>
    </div>
  );
}

function IosInstallModal({ onClose }) {
  const { t } = useLanguage();
  const steps = [
    { icon: Share, text: t("pwaIosStep1") },
    { icon: PlusSquare, text: t("pwaIosStep2") },
    { icon: Download, text: t("pwaIosStep3") },
  ];
  return (
    <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose} data-testid="pwa-ios-modal">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-extrabold text-slate-100">{t("pwaIosTitle")}</h3>
          <button onClick={onClose} data-testid="pwa-ios-close" className="text-slate-400 hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>
        <ol className="space-y-4">
          {steps.map(({ icon: Icon, text }, i) => (
            <li key={i} className="flex items-center gap-3 text-sm text-slate-300">
              <span className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-emerald-400" />
              </span>
              <span><span className="font-bold text-emerald-400 me-1">{i + 1}.</span>{text}</span>
            </li>
          ))}
        </ol>
        <button onClick={onClose} data-testid="pwa-ios-done"
          className="mt-6 w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-bold transition-colors">
          {t("pwaClose")}
        </button>
      </div>
    </div>
  );
}

export function InstallPrompt() {
  const { t } = useLanguage();
  const [deferred, setDeferred] = useState(null);
  const [visible, setVisible] = useState(false);
  const [iosModal, setIosModal] = useState(false);
  const ios = isIos();

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if (isStandalone() || installDismissed()) return;
    if (!deferred && !ios) return;
    const timer = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(timer);
  }, [deferred, ios]);

  if (!visible) return null;

  const close = () => {
    dismissInstall();
    setVisible(false);
  };

  const install = async () => {
    if (ios) {
      setIosModal(true);
      return;
    }
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      setDeferred(null);
      setVisible(false);
    }
  };

  return (
    <>
      <div data-testid="pwa-install-card"
        className="fixed bottom-4 start-4 z-[85] w-[calc(100%-2rem)] max-w-xs bg-slate-900/95 backdrop-blur border border-slate-700 rounded-2xl p-4 shadow-2xl fade-up">
        <button onClick={close} data-testid="pwa-install-dismiss" aria-label={t("pwaClose")}
          className="absolute top-2.5 end-2.5 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
        <div className="flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="ProfitLens" className="w-11 h-11 rounded-xl shrink-0" />
          <div className="min-w-0">
            <p className="font-extrabold text-sm text-slate-100">{t("pwaInstallTitle")}</p>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{t("pwaInstallSub")}</p>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={install} data-testid="pwa-install-btn"
            className="flex-1 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-extrabold transition-colors flex items-center justify-center gap-1.5">
            <Download className="w-4 h-4" />
            {t("pwaInstallBtn")}
          </button>
          <button onClick={close} data-testid="pwa-install-later"
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold transition-colors">
            {t("pwaLater")}
          </button>
        </div>
      </div>
      {iosModal && <IosInstallModal onClose={() => { setIosModal(false); close(); }} />}
    </>
  );
}
