import { Building2, Loader2 } from "lucide-react";
import { COUNTRIES, CURRENCY_OPTIONS, CURRENCY_LABELS, countryByCode, countryName } from "../../lib/locale";

const TIMEZONES = ["UTC", "Asia/Damascus", "Asia/Riyadh", "Asia/Dubai", "Africa/Cairo", "Asia/Amman", "Asia/Baghdad", "Asia/Beirut", "Asia/Kuwait", "Asia/Qatar", "Asia/Bahrain", "Asia/Muscat", "Asia/Aden", "Europe/Istanbul", "Europe/London", "Europe/Berlin", "America/New_York"];
const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";

export function BusinessSection({ biz, setBiz, savingBiz, onSave, t, lang }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6" data-testid="settings-business">
      <div className="flex items-center gap-2 mb-4">
        <Building2 className="w-5 h-5 text-emerald-500" />
        <h3 className="font-bold text-slate-900">{t("businessSection")}</h3>
      </div>
      <form onSubmit={onSave} className="space-y-4" data-testid="business-form">
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("bizName")}</label>
          <input data-testid="biz-name-input" value={biz.name} onChange={(e) => setBiz((b) => ({ ...b, name: e.target.value }))} required className={inputCls} />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("obBizType")}</label>
          <select data-testid="biz-type-select" value={biz.business_type || "other"} onChange={(e) => setBiz((b) => ({ ...b, business_type: e.target.value }))} className={inputCls}>
            {["retail", "ecommerce", "services", "food", "wholesale", "other"].map((bt) => <option key={bt} value={bt} data-testid={`biz-type-${bt}`}>{t(`obType_${bt}`)}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("countryLabel")}</label>
            <select data-testid="biz-country-select" value={biz.country}
              onChange={(e) => {
                const c = countryByCode(e.target.value);
                setBiz((b) => ({ ...b, country: e.target.value, base_currency: c ? c.currency : b.base_currency }));
              }} className={inputCls}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code} data-testid={`country-option-${c.code}`}>{countryName(c, lang)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("bizCurrency")}</label>
            <select data-testid="biz-currency-select" value={biz.base_currency} onChange={(e) => setBiz((b) => ({ ...b, base_currency: e.target.value }))} className={inputCls}>
              {CURRENCY_OPTIONS.map((c) => <option key={c} value={c} data-testid={`currency-option-${c}`}>{CURRENCY_LABELS[lang]?.[c] || c}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("dateFormatLabel")}</label>
            <select data-testid="biz-date-format-select" value={biz.date_format} onChange={(e) => setBiz((b) => ({ ...b, date_format: e.target.value }))} className={inputCls}>
              <option value="dmy">31/12/2026</option>
              <option value="mdy">12/31/2026</option>
              <option value="ymd">2026-12-31</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("numberFormatLabel")}</label>
            <select data-testid="biz-number-format-select" value={biz.number_format} onChange={(e) => setBiz((b) => ({ ...b, number_format: e.target.value }))} className={inputCls}>
              <option value="western">1,234.56</option>
              <option value="european">1.234,56</option>
              <option value="arabic">١٬٢٣٤٫٥٦</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2" data-testid="currency-change-note">{t("currencyChangeNote")}</p>
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("bizTimezone")}</label>
          <select data-testid="biz-timezone-select" value={biz.timezone} onChange={(e) => setBiz((b) => ({ ...b, timezone: e.target.value }))} className={inputCls}>
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700 cursor-pointer" data-testid="biz-neg-stock-toggle">
          <input type="checkbox" checked={biz.allow_negative_stock} onChange={(e) => setBiz((b) => ({ ...b, allow_negative_stock: e.target.checked }))}
            className="w-4 h-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-500" />
          {t("allowNegStock")}
        </label>
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("openingBalance")}</label>
          <input data-testid="biz-opening-input" type="number" min="0" step="any" dir="ltr" value={biz.cash_opening}
            onChange={(e) => setBiz((b) => ({ ...b, cash_opening: e.target.value }))} className={`${inputCls} tabular`} />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("lockTimeout")}</label>
          <select data-testid="biz-lock-timeout-select" value={biz.lock_timeout_minutes}
            onChange={(e) => setBiz((b) => ({ ...b, lock_timeout_minutes: parseInt(e.target.value, 10) }))} className={inputCls}>
            <option value={0}>{t("lockOff")}</option>
            {[5, 10, 15, 30].map((n) => (
              <option key={n} value={n}>{t("lockMinutes", { n })}</option>
            ))}
          </select>
        </div>
        <button data-testid="biz-save-btn" type="submit" disabled={savingBiz || !biz.name.trim()}
          className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
          {savingBiz && <Loader2 className="w-4 h-4 animate-spin" />}
          {t("bizSave")}
        </button>
      </form>
    </div>
  );
}
