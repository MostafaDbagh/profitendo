import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { PremiumBadge } from "../PremiumLock";
import { fmtMoney } from "../../lib/calculations";

const CHART_MARGIN = { top: 4, right: 8, left: 8, bottom: 4 };
const AXIS_TICK = { fontSize: 11, fill: "#64748B" };
const TOOLTIP_STYLE = { borderRadius: 12, border: "1px solid #E2E8F0", fontSize: 13 };
const BAR_RADIUS = [6, 6, 0, 0];
const LEGEND_STYLE = { fontSize: 12 };

export function ChartsSection({ barData, pieData, t }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm" data-testid="profit-bar-chart">
        <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">{t("profitByProduct")} <PremiumBadge /></h3>
        <div className="h-64 min-h-[16rem]" dir="ltr">
          <ResponsiveContainer width="100%" height="100%" minHeight={240}>
            <BarChart data={barData} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v) => [fmtMoney(v), t("netProfit")]} contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="profit" radius={BAR_RADIUS}>
                {barData.map((d) => (
                  <Cell key={d.name} fill={d.profit < 0 ? "#EF4444" : "#10B981"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm" data-testid="cost-donut-chart">
        <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">{t("costSplit")} <PremiumBadge /></h3>
        <div className="h-64 min-h-[16rem]" dir="ltr">
          <ResponsiveContainer width="100%" height="100%" minHeight={240}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3} strokeWidth={0}>
                {pieData.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={TOOLTIP_STYLE} />
              <Legend iconSize={10} wrapperStyle={LEGEND_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
