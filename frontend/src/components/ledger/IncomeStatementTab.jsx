import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "../../lib/api";
import { fmtMoney } from "../../lib/calculations";
import { useLanguage } from "../../context/LanguageContext";
import { useAcctName } from "./JournalTab";

const inputCls = "px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";

const Row = ({ label, amount, muted }) => (
  <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
    <span className={`text-sm ${muted ? "text-slate-400 ps-4" : "text-slate-600"}`}>{label}</span>
    <span className="text-sm tabular text-slate-700">{fmtMoney(amount)}</span>
  </div>
);

const Total = ({ label, amount, tone }) => (
  <div className={`flex items-center justify-between rounded-xl px-4 py-3 mt-2 ${tone === "net" ? (amount >= 0 ? "bg-emerald-50" : "bg-rose-50") : "bg-slate-50"}`}>
    <span className={`text-sm font-bold ${tone === "net" ? (amount >= 0 ? "text-emerald-800" : "text-rose-700") : "text-slate-800"}`}>{label}</span>
    <span className={`text-base font-extrabold tabular ${tone === "net" ? (amount >= 0 ? "text-emerald-700" : "text-rose-600") : "text-slate-900"}`}>{fmtMoney(amount)}</span>
  </div>
);

export function IncomeStatementTab() {
  const { t } = useLanguage();
  const acctName = useAcctName();
  const [data, setData] = useState(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const load = useCallback(() => {
    const params = {};
    if (fromDate) params.from_date = fromDate;
    if (toDate) params.to_date = toDate;
    api.get("/ledger/income-statement", { params }).then(({ data }) => setData(data)).catch(() => toast.error(t("somethingWrong")));
  }, [fromDate, toDate, t]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="flex justify-center py-14"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>;

  return (
    <div data-testid="income-statement-tab">
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 whitespace-nowrap">{t("fromDate")}</label>
          <input data-testid="is-from-date" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${inputCls} tabular`} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 whitespace-nowrap">{t("toDate")}</label>
          <input data-testid="is-to-date" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${inputCls} tabular`} />
        </div>
      </div>

      <div className="max-w-2xl">
        <p className="text-sm font-bold text-slate-800 mb-1">{t("isRevenueSection")}</p>
        {data.revenue.map((r) => <Row key={r.account_id} label={acctName(r.code, r.name)} amount={r.amount} muted />)}
        <Row label={t("isRevenueSection")} amount={data.revenue_total} />
        <p className="text-sm font-bold text-slate-800 mt-4 mb-1">{t("isLessCogs")}</p>
        {data.cost_of_sales.map((r) => <Row key={r.account_id} label={acctName(r.code, r.name)} amount={r.amount} muted />)}
        <div data-testid="is-gross-profit"><Total label={t("isGrossProfit")} amount={data.gross_profit} /></div>
        <p className="text-sm font-bold text-slate-800 mt-4 mb-1">{t("isLessExpenses")}</p>
        {data.expenses.map((r) => <Row key={r.account_id} label={acctName(r.code, r.name)} amount={r.amount} muted />)}
        <Row label={t("isLessExpenses")} amount={data.expenses_total} />
        <div data-testid="is-net-income"><Total label={t("isNetIncome")} amount={data.net_income} tone="net" /></div>
      </div>
    </div>
  );
}
