import { Activity, AlertOctagon, AlertTriangle, Crown, Sparkles } from "lucide-react";
import { PremiumBadge } from "../PremiumLock";

const insightStyle = {
  danger: { icon: AlertOctagon, cls: "bg-red-50 border-red-100 text-red-700", iconCls: "text-red-500" },
  warning: { icon: AlertTriangle, cls: "bg-amber-50 border-amber-100 text-amber-700", iconCls: "text-amber-500" },
  info: { icon: Activity, cls: "bg-yellow-50 border-yellow-100 text-yellow-700", iconCls: "text-yellow-500" },
  success: { icon: Sparkles, cls: "bg-emerald-50 border-emerald-100 text-emerald-700", iconCls: "text-emerald-500" },
};

export function InsightsPanel({ insights, t }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm" data-testid="insights-section">
      <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">{t("insightsTitle")} <PremiumBadge /></h3>
      {insights.length === 0 ? (
        <p className="text-sm text-slate-400" data-testid="insights-empty">{t("noInsights")}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {insights.map((ins, idx) => {
            const s = insightStyle[ins.level];
            const Icon = s.icon;
            return (
              <div
                key={`${ins.title}-${idx}`}
                data-testid={`insight-${ins.title}`}
                className={`flex items-start gap-3 rounded-xl border p-4 ${s.cls}`}
              >
                <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${s.iconCls}`} />
                <p className="text-sm font-medium flex-1">{t(ins.key, { name: ins.name })}</p>
                <Crown className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
