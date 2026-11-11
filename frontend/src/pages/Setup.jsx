import { useMemo, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { TrendingUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { setCurrency } from "../lib/calculations";
import { COUNTRIES, CURRENCY_OPTIONS, CURRENCY_LABELS, countryByCode, countryName, detectCountry, setRegionalPrefs } from "../lib/locale";

const TIMEZONES = ["UTC", "Asia/Damascus", "Asia/Riyadh", "Asia/Dubai", "Africa/Cairo", "Asia/Amman", "Asia/Baghdad", "Asia/Beirut", "Asia/Kuwait", "Asia/Qatar", "Asia/Bahrain", "Asia/Muscat", "Asia/Aden", "Europe/Istanbul", "Europe/London", "Europe/Berlin", "America/New_York"];

const inputCls =
  "w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";

export default function Setup() {
  const { user, checked, checkAuth } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const detected = useMemo(() => detectCountry(), []);
  const browserTz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
  }, []);
  const tzOptions = TIMEZONES.includes(browserTz) ? TIMEZONES : [browserTz, ...TIMEZONES];
  const [form, setForm] = useState({
    name: "",
    country: detected.code,
    base_currency: detected.currency,
    timezone: browserTz,
    date_format: "dmy",
    number_format: "western",
  });
  const [saving, setSaving] = useState(false);

  if (checked && !user) return <Navigate to="/auth" replace />;
  if (user?.business?.setup_completed) return <Navigate to="/onboarding" replace />;

  const onCountry = (v) => {
    const c = countryByCode(v);
    setForm((f) => ({ ...f, country: v, base_currency: c ? c.currency : f.base_currency }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api.post("/business/setup", form);
      setCurrency(form.base_currency);
      setRegionalPrefs(form);
      await checkAuth();
      toast.success(t("bizSaved"));
      navigate("/onboarding", { replace: true });
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" data-testid="setup-page">
      <div className="w-full max-w-md fade-up">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl text-slate-900">{t("appName")}</span>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <h1 className="text-2xl font-bold text-slate-900" data-testid="setup-title">{t("setupTitle")}</h1>
          <p className="text-slate-500 text-sm mt-1 mb-6">{t("setupDesc")}</p>
          <form onSubmit={submit} className="space-y-4" data-testid="setup-form">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("bizName")}</label>
              <input
                data-testid="setup-name-input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("bizNamePh")}
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("countryLabel")}</label>
              <select
                data-testid="setup-country-select"
                value={form.country}
                onChange={(e) => onCountry(e.target.value)}
                className={inputCls}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code} data-testid={`country-option-${c.code}`}>{countryName(c, lang)}</option>
                ))}
              </select>
              {form.country === detected.code && (
                <p className="text-xs text-emerald-600 mt-1.5">{t("detectedCountryHint", { country: countryName(detected, lang) })}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("bizCurrency")}</label>
              <select
                data-testid="setup-currency-select"
                value={form.base_currency}
                onChange={(e) => setForm((f) => ({ ...f, base_currency: e.target.value }))}
                className={inputCls}
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c} data-testid={`currency-option-${c}`}>{CURRENCY_LABELS[lang]?.[c] || c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("bizTimezone")}</label>
              <select
                data-testid="setup-timezone-select"
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                className={inputCls}
              >
                {tzOptions.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("dateFormatLabel")}</label>
                <select
                  data-testid="setup-date-format-select"
                  value={form.date_format}
                  onChange={(e) => setForm((f) => ({ ...f, date_format: e.target.value }))}
                  className={inputCls}
                >
                  <option value="dmy">31/12/2026</option>
                  <option value="mdy">12/31/2026</option>
                  <option value="ymd">2026-12-31</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("numberFormatLabel")}</label>
                <select
                  data-testid="setup-number-format-select"
                  value={form.number_format}
                  onChange={(e) => setForm((f) => ({ ...f, number_format: e.target.value }))}
                  className={inputCls}
                >
                  <option value="western">1,234.56</option>
                  <option value="european">1.234,56</option>
                  <option value="arabic">١٬٢٣٤٫٥٦</option>
                </select>
              </div>
            </div>
            <button
              data-testid="setup-save-btn"
              type="submit"
              disabled={saving || !form.name.trim()}
              className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("setupSave")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
