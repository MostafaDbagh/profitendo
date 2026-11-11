import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import api from "../../lib/api";
import { fmtMoney } from "../../lib/calculations";
import { useLanguage } from "../../context/LanguageContext";
import { useAcctName } from "./JournalTab";

const NON_CURRENT_CODES = new Set(["1500"]);
const Row = ({ label, amount }) => (
  <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
    <span className="text-sm text-slate-600">{label}</span>
    <span className="text-sm tabular text-slate-700">{fmtMoney(amount)}</span>
  </div>
);

function Section({ title, rows, total, testid }) {
  const { t } = useLanguage();
  return (
    <div className="rounded-xl border border-slate-200 p-5" data-testid={testid}>
      <p className="text-sm font-bold text-slate-800 mb-2">{title}</p>
      {rows.length === 0 ? <p className="text-xs text-slate-400 py-1">—</p> : rows.map((r) => <Row key={r.account_id} label={r.label} amount={r.amount} />)}
      <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-200">
        <span className="text-sm font-bold text-slate-800">{t("tbTotals")}</span>
        <span className="text-sm font-extrabold tabular text-slate-900">{fmtMoney(total)}</span>
      </div>
    </div>
  );
}

export function BalanceSheetTab() {
  const { t } = useLanguage();
  const acctName = useAcctName();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/ledger/balance-sheet").then(({ data }) => setData(data)).catch(() => toast.error(t("somethingWrong")));
  }, [t]);

  if (!data) return <div className="flex justify-center py-14"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>;

  const named = (rows) => rows.map((r) => ({ ...r, label: acctName(r.code, r.name) }));
  const assets = named(data.assets);
  const currentAssets = assets.filter((r) => !NON_CURRENT_CODES.has(r.code) && parseInt(r.code, 10) < 1500);
  const nonCurrentAssets = assets.filter((r) => NON_CURRENT_CODES.has(r.code) || parseInt(r.code, 10) >= 1500);
  const currentTotal = Math.round(currentAssets.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const nonCurrentTotal = Math.round((data.total_assets - currentTotal) * 100) / 100;
  const equityRows = [...named(data.equity), { account_id: "earnings", label: t("bsCurrentEarnings"), amount: data.current_earnings }];

  return (
    <div data-testid="balance-sheet-tab">
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Section title={t("bsCurrentAssets")} rows={currentAssets} total={currentTotal} testid="bs-current-assets" />
          <Section title={t("bsNonCurrentAssets")} rows={nonCurrentAssets} total={nonCurrentTotal} testid="bs-non-current-assets" />
          <div className="rounded-xl bg-slate-900 text-white px-5 py-4 flex items-center justify-between" data-testid="bs-total-assets">
            <span className="font-bold">{t("bsTotalAssets")}</span>
            <span className="text-lg font-extrabold tabular">{fmtMoney(data.total_assets)}</span>
          </div>
        </div>
        <div className="space-y-4">
          <Section title={t("bsLiabilitiesSection")} rows={named(data.liabilities)} total={data.total_liabilities} testid="bs-liabilities" />
          <Section title={t("bsEquitySection")} rows={equityRows} total={Math.round((data.total_equity + data.current_earnings) * 100) / 100} testid="bs-equity" />
          <div className="rounded-xl bg-slate-900 text-white px-5 py-4 flex items-center justify-between" data-testid="bs-total-le">
            <span className="font-bold">{t("bsTotalLE")}</span>
            <span className="text-lg font-extrabold tabular">{fmtMoney(data.total_liabilities_equity)}</span>
          </div>
        </div>
      </div>
      <div className={`mt-5 rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-sm font-bold ${data.balanced ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`} data-testid="bs-equation">
        {data.balanced ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
        {t(data.balanced ? "bsEquationOk" : "bsEquationBad")}
      </div>
    </div>
  );
}
