import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fmtMoney, fmtPct } from "../../lib/calculations";

const TOOLTIP_STYLE = { borderRadius: 12, border: "1px solid #E2E8F0", fontSize: 13 };
const LEGEND_STYLE = { fontSize: 12 };

export function BreakdownCard({ p, bd, optionalRows, pieData, t }) {
  return (
    <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm p-6" data-testid="cost-breakdown-card">
      <h3 className="font-bold text-slate-900 mb-5">{t("breakdownTitle")}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">{t("requiredSection")}</p>
          <ul className="space-y-3 mb-6">
            <li className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-600">{t("sellingPrice")}</span>
              <span className="text-sm font-semibold text-slate-800 tabular" data-testid="bd-selling-price">{fmtMoney(p.selling_price)}</span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-600">{t("fCost")}</span>
              <span className="text-sm font-semibold text-slate-800 tabular" data-testid="bd-product-cost">{fmtMoney(bd.product_cost)}</span>
            </li>
          </ul>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">{t("optionalSection")}</p>
          <ul className="space-y-3">
            {optionalRows.map((r) => (
              <li key={r.label} className="flex items-start justify-between gap-3" data-testid={`bd-row-${r.label}`}>
                <div>
                  <p className={`text-sm ${r.value > 0 ? "text-slate-600" : "text-slate-400"}`}>{r.label}</p>
                  {r.value > 0 && r.mode === "total" && (
                    <p className="text-xs text-slate-400">
                      {t("totalModeNote", { total: fmtMoney(r.raw), qty: p.quantity_sold })}
                    </p>
                  )}
                  {r.value > 0 && r.mode === "percent" && (
                    <p className="text-xs text-slate-400">{t("percentNote", { pct: r.raw })}</p>
                  )}
                </div>
                <span className={`text-sm tabular ${r.value > 0 ? "font-semibold text-slate-800" : "text-slate-400"}`}>
                  {fmtMoney(r.value)}
                </span>
              </li>
            ))}
          </ul>
          <div className="h-px bg-slate-100 my-4" />
          <ul className="space-y-3">
            <li className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-slate-900">{t("totalCostsLabel")}</span>
              <span className="text-sm font-extrabold text-slate-900 tabular" data-testid="bd-total-cost">{fmtMoney(p.unit_cost)}</span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-slate-900">{t("netProfit")}</span>
              <span className={`text-sm font-extrabold tabular ${p.unit_profit < 0 ? "text-red-600" : "text-emerald-600"}`} data-testid="bd-net-profit">
                {fmtMoney(p.unit_profit)}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-slate-900">{t("profitMargin")}</span>
              <span className={`text-sm font-extrabold tabular ${p.profit_margin < 0 ? "text-red-600" : "text-emerald-600"}`} data-testid="bd-margin">
                {fmtPct(p.profit_margin)}
              </span>
            </li>
          </ul>
          <p className="text-xs text-slate-400 mt-3">{t("perUnit")}</p>
        </div>
        <div className="h-52 min-h-[13rem] self-center" dir="ltr">
          {pieData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center pt-16">{t("noResults")}</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%" minHeight={200}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={3} strokeWidth={0}>
                  {pieData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={TOOLTIP_STYLE} />
                <Legend iconSize={10} wrapperStyle={LEGEND_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
