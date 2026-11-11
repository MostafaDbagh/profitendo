import { Calculator, Loader2 } from "lucide-react";
import { fmtMoney, fmtPct } from "../../lib/calculations";

export function CalcPanel({ m, t, saving, canSave }) {
  return (
    <div
      className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 lg:sticky lg:top-24"
      data-testid="live-calc-panel"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 mb-5">
        <Calculator className="w-5 h-5 text-emerald-500" />
        <h3 className="font-bold text-slate-900">{t("liveTitle")}</h3>
      </div>
      <dl className="space-y-4">
        <div className="flex items-center justify-between">
          <dt className="text-sm text-slate-500">{t("unitCost")}</dt>
          <dd className="font-bold text-slate-900 tabular" data-testid="live-unit-cost">
            {fmtMoney(m.unitCost)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-sm text-slate-500">{t("unitProfit")}</dt>
          <dd
            className={`font-bold tabular ${m.unitProfit < 0 ? "text-red-600" : "text-emerald-600"}`}
            data-testid="live-unit-profit"
          >
            {fmtMoney(m.unitProfit)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-sm text-slate-500">{t("profitMargin")}</dt>
          <dd
            className={`font-bold tabular ${m.margin < 0 ? "text-red-600" : "text-emerald-600"}`}
            data-testid="live-margin"
          >
            {fmtPct(m.margin)}
          </dd>
        </div>
        <div className="h-px bg-slate-100" />
        <div className="flex items-center justify-between">
          <dt className="text-sm font-semibold text-slate-700">{t("totalProfitLabel")}</dt>
          <dd
            className={`text-lg font-extrabold tabular ${m.netProfit < 0 ? "text-red-600" : "text-emerald-600"}`}
            data-testid="live-total-profit"
          >
            {fmtMoney(m.netProfit)}
          </dd>
        </div>
      </dl>
      <button
        data-testid="form-save-btn"
        type="submit"
        disabled={saving || !canSave}
        className="w-full mt-6 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors duration-150 disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {saving ? t("saving") : t("saveProduct")}
      </button>
    </div>
  );
}
