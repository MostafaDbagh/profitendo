import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import api from "../../lib/api";
import { fmtMoney } from "../../lib/calculations";
import { useLanguage } from "../../context/LanguageContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

const METRIC_TITLE = {
  total_sales: "totalSales", cogs: "productCosts", additional_costs: "additionalCosts",
  net_profit: "netProfit", profit_margin: "profitMargin", inventory_value: "statInventoryValue",
  cash_balance: "statCash", returns: "statReturns", low_stock: "lowStockTitle",
  top_profitable: "topProfitable", revenue_distribution: "revDist",
};

const METRIC_COLS = {
  total_sales: [["sale_number", "colInvoiceNo"], ["date", "colDate"], ["customer", "colCustomer"], ["payment_method", "fldPaymentMethod"], ["total", "colTotal", "money"]],
  cogs: [["sale_number", "colInvoiceNo"], ["date", "colDate"], ["total", "colTotal", "money"], ["cogs", "colCogs", "money"]],
  additional_costs: [["name", "colProduct"], ["quantity_sold", "colQtySold"], ["additional_per_unit", "colPerUnit", "money"], ["total", "colTotal", "money"]],
  inventory_value: [["name", "colProduct"], ["sku", "fldSku"], ["stock_qty", "colStock"], ["product_cost", "colCost", "money"], ["value", "colValue", "money"]],
  returns: [["return_number", "colInvoiceNo"], ["return_date", "colDate"], ["reason", "colReason"], ["refund_total", "colTotal", "money"], ["status", "colStatus"]],
  low_stock: [["name", "colProduct"], ["sku", "fldSku"], ["stock_qty", "colStock"], ["minimum_stock_level", "colMin"]],
  top_profitable: [["name", "colProduct"], ["revenue", "colRevenue", "money"], ["net_profit", "colProfit", "money"], ["profit_margin", "colMargin"]],
  revenue_distribution: [["name", "colProduct"], ["revenue", "colRevenue", "money"], ["share", "colShare"]],
};

const SUMMARY_ROWS = {
  net_profit: [["sales_revenue", "totalSales"], ["refunds", "drillRefunds"], ["cogs_net", "drillCogsNet"], ["additional_costs", "additionalCosts"], ["net_profit", "netProfit"], ["profit_margin", "profitMargin"]],
  profit_margin: [["sales_revenue", "totalSales"], ["refunds", "drillRefunds"], ["cogs_net", "drillCogsNet"], ["additional_costs", "additionalCosts"], ["net_profit", "netProfit"], ["profit_margin", "profitMargin"]],
  cash_balance: [["balance", "statCash"]],
};

export function DrilldownModal({ metric, onClose }) {
  const { t } = useLanguage();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!metric) return;
    setData(null);
    api.get("/dashboard/drilldown", { params: { metric } })
      .then(({ data }) => setData(data))
      .catch((err) => { toast.error(t("somethingWrong")); onClose(); });
  }, [metric]); // eslint-disable-line react-hooks/exhaustive-deps

  const cols = METRIC_COLS[metric] || [];
  const summaryRows = SUMMARY_ROWS[metric] || [];

  const cell = (row, key, kind) => {
    let v = row[key];
    if (v === null || v === undefined || v === "") return "—";
    if (kind === "money") return fmtMoney(v);
    if (key === "date" || key === "return_date") return String(v).slice(0, 10);
    if (key === "share" || key === "profit_margin") return `${v}%`;
    return String(v);
  };

  return (
    <Dialog open={!!metric} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-white border-slate-200 max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl" data-testid={`drilldown-${metric}`}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-slate-900">{t(METRIC_TITLE[metric] || metric)}</DialogTitle>
        </DialogHeader>
        {!data ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>
        ) : (
          <>
            {data.summary && (
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 mb-4 space-y-1.5" data-testid="drilldown-summary">
                {summaryRows.map(([key, labelKey]) => (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">{t(labelKey)}</span>
                    <span className="font-bold tabular text-slate-800">
                      {key === "profit_margin" ? `${data.summary[key]}%` : fmtMoney(data.summary[key])}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {data.rows && data.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-400 border-b border-slate-100">
                      {cols.map(([key, labelKey]) => <th key={key} className="text-start py-2 font-medium">{t(labelKey)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100" data-testid={`drill-row-${i}`}>
                        {cols.map(([key, labelKey, kind]) => (
                          <td key={key} className="py-2 pe-3 text-slate-700 tabular">{cell(row, key, kind)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !data.summary && <p className="text-sm text-slate-400 text-center py-8">{t("drillEmpty")}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
