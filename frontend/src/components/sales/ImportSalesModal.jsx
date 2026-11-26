import { formatQuantity } from '@/lib/quantity';
import { useCsvImport } from "../useCsvImport";
import { Upload, Download, Loader2, CheckCircle2, XCircle, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

const selectCls = "w-full px-2.5 py-2 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-100 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500";
const STATUS_STYLE = {
  new: { cls: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30", icon: CheckCircle2, key: "statusNew" },
  duplicate: { cls: "bg-amber-500/15 text-amber-300 border border-amber-500/30", icon: AlertTriangle, key: "statusDuplicate" },
  invalid: { cls: "bg-red-500/15 text-red-300 border border-red-500/30", icon: XCircle, key: "statusInvalid" },
};
const REASON_KEY = {
  existing_invoice_conflict: "reasonExistingInvoiceConflict",
  invoice_invalid: "reasonInvoiceInvalid", invoice_conflict: "reasonInvoiceConflict",
  invalid_payment_method: "reasonInvalidPaymentMethod", invalid_date: "reasonInvalidImportDate",
  ambiguous_product: "reasonAmbiguousProduct", field_too_long: "reasonImportFieldTooLong",
  product_not_found: "reasonProductNotFound", invalid_price: "reasonInvalidPrice",
  invalid_quantity: "reasonInvalidQuantity", insufficient_stock: "reasonInsufficientStock", exists_ref: "reasonExistsRef",
};
const FIELDS = ["invoice_ref", "date", "customer", "product", "quantity", "unit_price", "payment_method", "notes"];
const FIELD_KEY = {
  invoice_ref: "fldInvoiceRef", date: "fldDate", customer: "fldCustomer", product: "fldProduct",
  quantity: "fldQuantity", unit_price: "fldUnitPrice", payment_method: "fldPaymentMethod", notes: "fldNotes",
};

export function ImportSalesModal({ open, onClose, onImported }) {
  const { t } = useLanguage();
  const { file, fileRef, headers, mapping, setMapping, rows, summary, loading, committing,
    result, close, commit, pickFile } = useCsvImport("sales", t, onClose, onImported);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="dark bg-slate-800/95 backdrop-blur border-slate-700/50 text-slate-100 max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl" data-testid="import-sales-modal">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" /> {t("importSalesTitle")}
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="text-center py-6" data-testid="import-sales-result">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
            <p className="text-lg font-bold text-slate-100 mb-4">{t("importDone")}</p>
            <div className="flex justify-center gap-3 text-sm flex-wrap">
              <span className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 font-semibold">{result.invoices_created} {t("invoicesCreated")}</span>
              <span className="px-3 py-1.5 rounded-lg bg-slate-500/15 text-slate-300 font-semibold">{result.rows_imported} {t("rowsImported")}</span>
              <span className="px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 font-semibold">{result.duplicate} {t("importSkipped")}</span>
              <span className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 font-semibold">{result.invalid} {t("importSummaryInvalid")}</span>
            </div>
            <button data-testid="import-sales-close-btn" onClick={close}
              className="mt-6 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors">إغلاق</button>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-400 mb-4">{t("salesImportDesc")}</p>
            <div className="flex flex-col sm:flex-row gap-3 mb-5">
              <input disabled={committing} ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" data-testid="import-sales-file-input"
                onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
              <button data-testid="import-sales-choose-file" disabled={committing} onClick={() => fileRef.current?.click()}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-slate-600 text-sm font-semibold text-slate-300 hover:border-emerald-500 hover:text-emerald-300 transition-colors">
                <Upload className="w-4 h-4" /> {file ? file.name : t("chooseFile")}
              </button>
              <a href={`${process.env.REACT_APP_BACKEND_URL}/api/sales/import/template`} download data-testid="import-sales-template-link"
                className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-700/50 text-sm font-semibold text-slate-400 hover:text-emerald-300 transition-colors">
                <Download className="w-4 h-4" /> {t("downloadTemplate")}
              </a>
            </div>

            {loading && !summary && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>}

            {mapping && (
              <div className="mb-5">
                <p className="text-sm font-bold text-slate-200 mb-2">{t("columnMapping")}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {FIELDS.map((f) => (
                    <div key={f}>
                      <label className="text-[11px] text-slate-400 mb-1 block">{t(FIELD_KEY[f])}</label>
                      <select disabled={committing} data-testid={`sales-map-${f}`} value={mapping[f] || ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })} className={selectCls}>
                        <option value="">{t("noMap")}</option>
                        {headers.filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary && (
              <>
                <div className="flex flex-wrap gap-2 mb-3" data-testid="import-sales-summary">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs font-bold">{summary.new} {t("importSummaryNew")}</span>
                  <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 text-xs font-bold">{summary.duplicate} {t("importSummaryDuplicate")}</span>
                  <span className="px-2.5 py-1 rounded-lg bg-red-500/15 text-red-300 text-xs font-bold">{summary.invalid} {t("importSummaryInvalid")}</span>
                </div>
                <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-700/50 mb-5" data-testid="import-sales-preview-table">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-800">
                      <tr className="text-slate-400 border-b border-slate-700/50">
                        <th className="text-start py-2 px-3 font-medium">{t("rowLabel")}</th>
                        <th className="text-start py-2 px-3 font-medium">{t("fldInvoiceRef")}</th>
                        <th className="text-start py-2 px-3 font-medium">{t("fldProduct")}</th>
                        <th className="text-start py-2 px-3 font-medium">{t("fldQuantity")}</th>
                        <th className="text-start py-2 px-3 font-medium">{t("colStatus")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const s = STATUS_STYLE[r.status];
                        return (
                          <tr key={r.row} className="border-b border-slate-700/30" data-testid={`sales-import-row-${r.row}`}>
                            <td className="py-2 px-3 tabular text-slate-500">{r.row}</td>
                            <td className="py-2 px-3 tabular text-slate-400">{r.values.invoice_ref || "—"}</td>
                            <td className="py-2 px-3 text-slate-200 max-w-[160px] truncate">{r.values.product || "—"}</td>
                            <td className="py-2 px-3 tabular text-slate-400">{formatQuantity(r.values.quantity ?? "—")}</td>
                            <td className="py-2 px-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold ${s.cls}`}>
                                <s.icon className="w-3 h-3" /> {t(s.key)}{r.reason ? ` · ${t(REASON_KEY[r.reason])}` : ""}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button data-testid="import-sales-commit-btn" onClick={commit} disabled={loading || !summary || summary.new === 0}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20">
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? t("importing") : `${t("commitImport")} (${summary?.new || 0})`}
                </button>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
