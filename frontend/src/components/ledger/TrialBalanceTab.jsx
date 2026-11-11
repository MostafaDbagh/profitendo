import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import api from "../../lib/api";
import { fmtMoney } from "../../lib/calculations";
import { useLanguage } from "../../context/LanguageContext";
import { useAcctName } from "./JournalTab";

const GROUP_ORDER = ["assets", "liabilities", "equity", "revenue", "cost_of_sales", "expenses"];

export function TrialBalanceTab() {
  const { t } = useLanguage();
  const acctName = useAcctName();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/ledger/trial-balance").then(({ data }) => setData(data)).catch(() => toast.error(t("somethingWrong")));
  }, [t]);

  if (!data) return <div className="flex justify-center py-14"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>;

  return (
    <div className="overflow-x-auto" data-testid="trial-balance-tab">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-400 border-b border-slate-100">
            <th className="text-start py-2 font-medium w-24">{t("colCode")}</th>
            <th className="text-start py-2 font-medium">{t("colAccount")}</th>
            <th className="text-end py-2 font-medium">{t("colDebitTotal")}</th>
            <th className="text-end py-2 font-medium">{t("colCreditTotal")}</th>
            <th className="text-end py-2 font-medium">{t("colNetBalance")}</th>
          </tr>
        </thead>
        <tbody>
          {GROUP_ORDER.map((g) => {
            const rows = data.rows.filter((r) => r.group === g);
            if (rows.length === 0) return null;
            return (
              <GroupRows key={g} group={g} rows={rows} t={t} acctName={acctName} />
            );
          })}
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold" data-testid="trial-balance-totals">
            <td colSpan={2} className="py-3 text-slate-800">{t("tbTotals")}</td>
            <td className="py-3 text-end tabular text-slate-800">{fmtMoney(data.total_debit)}</td>
            <td className="py-3 text-end tabular text-slate-800">{fmtMoney(data.total_credit)}</td>
            <td className="py-3 text-end">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${data.balanced ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`} data-testid="trial-balance-status">
                {data.balanced ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {t(data.balanced ? "balancedTag" : "unbalancedTag")}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({ group, rows, t, acctName }) {
  return (
    <>
      <tr className="bg-slate-50/70">
        <td colSpan={5} className="py-2 px-1 text-xs font-bold text-slate-500">{t(`acctGroup_${group}`)}</td>
      </tr>
      {rows.map((r) => (
        <tr key={r.account_id} className="border-b border-slate-100" data-testid={`tb-row-${r.code}`}>
          <td className="py-2.5 tabular text-slate-400">{r.code}</td>
          <td className="py-2.5 text-slate-700">{acctName(r.code, r.name)}</td>
          <td className="py-2.5 text-end tabular text-slate-600">{fmtMoney(r.debit)}</td>
          <td className="py-2.5 text-end tabular text-slate-600">{fmtMoney(r.credit)}</td>
          <td className={`py-2.5 text-end tabular font-semibold ${r.balance >= 0 ? "text-slate-800" : "text-rose-600"}`}>{fmtMoney(Math.abs(r.balance))}</td>
        </tr>
      ))}
    </>
  );
}
