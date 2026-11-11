import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { User, Languages, Database, Trash2, Loader2, ScrollText, Download, Sparkles } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { setCurrency } from "../lib/calculations";
import { detectCountry, setRegionalPrefs } from "../lib/locale";
import { BusinessSection } from "../components/settings/BusinessSection";
import { DangerZone } from "../components/settings/DangerZone";

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";

export default function Settings() {
  const { user, can, checkAuth } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [busy, setBusy] = useState(null);
  const [biz, setBiz] = useState(() => ({
    name: user?.business?.name || "",
    business_type: user?.business?.business_type || "other",
    country: user?.business?.country || detectCountry().code,
    base_currency: user?.business?.base_currency || "USD",
    timezone: user?.business?.timezone || "UTC",
    date_format: user?.business?.date_format || "dmy",
    number_format: user?.business?.number_format || "western",
    allow_negative_stock: user?.business?.allow_negative_stock || false,
    cash_opening: user?.business?.cash_opening ?? "",
    lock_timeout_minutes: user?.business?.lock_timeout_minutes || 0,
  }));
  const [savingBiz, setSavingBiz] = useState(false);
  const [pin, setPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const pinEnabled = user?.business?.pin_enabled;

  const savePin = async (e) => {
    e.preventDefault();
    setSavingPin(true);
    try {
      await api.post("/auth/pin", { pin });
      setPin("");
      await checkAuth();
      toast.success(t("pinSaved"));
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSavingPin(false);
    }
  };

  const clearPin = async () => {
    setSavingPin(true);
    try {
      await api.delete("/auth/pin");
      await checkAuth();
      toast.success(t("pinClearedMsg"));
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSavingPin(false);
    }
  };

  const saveBiz = async (e) => {
    e.preventDefault();
    setSavingBiz(true);
    try {
      const opening = biz.cash_opening === "" || biz.cash_opening == null ? 0 : Number(biz.cash_opening);
      await api.put("/business", { ...biz, cash_opening: Number.isFinite(opening) ? opening : 0 });
      setCurrency(biz.base_currency);
      setRegionalPrefs(biz);
      await checkAuth();
      toast.success(t("bizSaved"));
      if (searchParams.get("onboarding") === "1") {
        navigate("/onboarding");
        return;
      }
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSavingBiz(false);
    }
  };

  const startTour = async () => {
    try {
      await api.post("/onboarding/restart");
      navigate("/onboarding");
    } catch {
      toast.error(t("somethingWrong"));
    }
  };

  const seedDemo = async () => {
    setBusy("seed");
    try {
      await api.post("/demo/seed");
      toast.success(t("demoLoaded"));
    } catch {
      toast.error(t("somethingWrong"));
    } finally {
      setBusy(null);
    }
  };

  const clearDemo = async () => {
    setBusy("clear");
    try {
      await api.delete("/demo/clear");
      toast.success(t("demoCleared"));
    } catch {
      toast.error(t("somethingWrong"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl fade-up" data-testid="settings-page">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("settingsTitle")}</h1>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6" data-testid="settings-account">
        <div className="flex items-center gap-2 mb-4">
          <User className="w-5 h-5 text-emerald-500" />
          <h3 className="font-bold text-slate-900">{t("account")}</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-lg">
            {(user?.name || user?.email || "U").charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-slate-900" data-testid="settings-user-name">{user?.name}</p>
            <p className="text-sm text-slate-500" data-testid="settings-user-email">{user?.email}</p>
          </div>
        </div>
      </div>

      {can("settings.business") && (
        <BusinessSection biz={biz} setBiz={setBiz} savingBiz={savingBiz} onSave={saveBiz} t={t} lang={lang} />
      )}

      {can("employees.view") && (
        <Link to="/employees" data-testid="settings-users-link"
          className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors group">
          <div className="flex items-center gap-3">
            <User className="w-5 h-5 text-emerald-500" />
            <span className="font-bold text-slate-900">{t("usersPermsLink")}</span>
          </div>
          <span className="text-sm font-semibold text-emerald-600 group-hover:text-emerald-700">←</span>
        </Link>
      )}

      {can("settings.business") && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6" data-testid="settings-pin">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-slate-900">{t("pinSection")}</h3>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${pinEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`} data-testid="pin-status">
              {pinEnabled ? t("pinEnabledLabel") : t("pinDisabledLabel")}
            </span>
          </div>
          <p className="text-sm text-slate-500 mb-4">{t("pinDesc")}</p>
          <form onSubmit={savePin} className="flex gap-3" data-testid="pin-form">
            <input
              data-testid="pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              minLength={4}
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder={t("pinEnter")}
              className={`${inputCls} tabular`}
              dir="ltr"
            />
            <button data-testid="pin-save-btn" type="submit" disabled={savingPin || pin.length < 4}
              className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 whitespace-nowrap">
              {savingPin ? <Loader2 className="w-4 h-4 animate-spin" /> : t("pinSaved")}
            </button>
          </form>
          {pinEnabled && (
            <button onClick={clearPin} data-testid="pin-clear-btn" disabled={savingPin}
              className="mt-3 text-sm font-medium text-red-500 hover:text-red-600 transition-colors">
              {t("pinClear")}
            </button>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6" data-testid="settings-language">
        <div className="flex items-center gap-2 mb-1">
          <Languages className="w-5 h-5 text-emerald-500" />
          <h3 className="font-bold text-slate-900">{t("languageLabel")}</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">{t("languageDesc")}</p>
        <div className="flex gap-3">
          <button
            data-testid="lang-ar-btn"
            onClick={() => setLang("ar")}
            className={`flex-1 py-3 rounded-lg border font-semibold text-sm transition-colors ${
              lang === "ar"
                ? "bg-emerald-500 border-emerald-500 text-white"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            العربية
          </button>
          <button
            data-testid="lang-en-btn"
            onClick={() => setLang("en")}
            className={`flex-1 py-3 rounded-lg border font-semibold text-sm transition-colors ${
              lang === "en"
                ? "bg-emerald-500 border-emerald-500 text-white"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            English
          </button>
        </div>
      </div>

      {can("audit.view") && (
        <Link to="/audit" data-testid="settings-audit-link"
          className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors group">
          <div className="flex items-center gap-3">
            <ScrollText className="w-5 h-5 text-emerald-500" />
            <span className="font-bold text-slate-900">{t("auditTitle")}</span>
          </div>
          <span className="text-sm font-semibold text-emerald-600 group-hover:text-emerald-700">{t("viewAudit")} ←</span>
        </Link>
      )}

      <button onClick={startTour} data-testid="settings-tour-link"
        className="w-full flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors group">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-emerald-500" />
          <span className="font-bold text-slate-900">{t("obTour")}</span>
        </div>
        <span className="text-sm font-semibold text-emerald-600 group-hover:text-emerald-700">←</span>
      </button>

      {user?.role === "OWNER" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6" data-testid="settings-backup">
          <div className="flex items-center gap-2 mb-1">
            <Download className="w-5 h-5 text-emerald-500" />
            <h3 className="font-bold text-slate-900">{t("backupSection")}</h3>
          </div>
          <p className="text-sm text-slate-500 mb-1.5">{t("backupDesc")}</p>
          <p className="text-sm text-slate-400 mb-4">{t("backupExcelDesc")}</p>
          <div className="flex flex-wrap gap-2.5">
            <a
              href={`${process.env.REACT_APP_BACKEND_URL}/api/backup/export`}
              download
              data-testid="backup-download-btn"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700 font-semibold text-sm transition-colors"
            >
              <Download className="w-4 h-4" />
              {t("backupDownload")}
            </a>
            <a
              href={`${process.env.REACT_APP_BACKEND_URL}/api/backup/export.xlsx`}
              download
              data-testid="backup-download-xlsx-btn"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors"
            >
              <Download className="w-4 h-4" />
              {t("backupExcelDownload")}
            </a>
          </div>
        </div>
      )}

      {user?.role === "OWNER" && <DangerZone />}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6" data-testid="settings-demo">
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-5 h-5 text-emerald-500" />
          <h3 className="font-bold text-slate-900">{t("demoSection")}</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">{t("demoSectionDesc")}</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            data-testid="settings-load-demo-btn"
            onClick={seedDemo}
            disabled={busy !== null}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60"
          >
            {busy === "seed" && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("loadDemo")}
          </button>
          <button
            data-testid="settings-clear-demo-btn"
            onClick={clearDemo}
            disabled={busy !== null}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-lg border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-slate-600 font-semibold text-sm transition-colors disabled:opacity-60"
          >
            {busy === "clear" && <Loader2 className="w-4 h-4 animate-spin" />}
            <Trash2 className="w-4 h-4" />
            {t("clearDemo")}
          </button>
        </div>
      </div>
    </div>
  );
}
