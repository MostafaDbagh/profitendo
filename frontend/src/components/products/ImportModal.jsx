import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Download, Loader2, CheckCircle2, XCircle, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { useLanguage } from "../../context/LanguageContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

const selectCls = "w-full px-2.5 py-2 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-100 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500";
const STATUS_STYLE = {
  new: { cls: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30", icon: CheckCircle2, key: "statusNew" },
  update: { cls: "bg-sky-500/15 text-sky-300 border border-sky-500/30", icon: CheckCircle2, key: "statusUpdate" },
  duplicate: { cls: "bg-amber-500/15 text-amber-300 border border-amber-500/30", icon: AlertTriangle, key: "statusDuplicate" },
  invalid: { cls: "bg-red-500/15 text-red-300 border border-red-500/30", icon: XCircle, key: "statusInvalid" },
};
const REASON_KEY = {
  missing_name: "reasonMissingName", invalid_price: "reasonInvalidPrice", invalid_quantity: "reasonInvalidQuantity",
  duplicate_in_file: "reasonDupFile", exists_sku: "reasonDupDb", exists_name: "reasonDupDb",
};
const FIELD_KEY = {
  name: "fldName", sku: "fldSku", category: "fldCategory", unit: "fldUnit",
  purchase_price: "fldPurchasePrice", selling_price: "fldSellingPrice",
  initial_quantity: "fldInitialQty", description: "fldDescription",
};

export function ImportModal({ open, onClose, onImported }) {
  const { t } = useLanguage();
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState(null);
  const [strategy, setStrategy] = useState("skip");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const reset = () => { setFile(null); setHeaders([]); setMapping(null); setStrategy("skip"); setRows([]); setSummary(null); setResult(null); };
  const close = () => { reset(); onClose(); };

  const preview = useCallback(async (f, m, s) => {
    if (!f) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("mapping", JSON.stringify(m || {}));
      fd.append("strategy", s);
      const { data } = await api.post("/products/import/preview", fd);
      setHeaders(data.headers);
      if (!m || !Object.values(m).some(Boolean)) setMapping(data.suggested_mapping);
      setRows(data.rows);
      setSummary(data.summary);
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (file && mapping) {
      const h = setTimeout(() => preview(file, mapping, strategy), 350);
      return () => clearTimeout(h);
    }
  }, [mapping, strategy]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickFile = (f) => {
    if (!f) return;
    setResult(null);
    setFile(f);
    preview(f, null, strategy);
  };

  const commit = async () => {
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mapping", JSON.stringify(mapping));
      fd.append("strategy", strategy);
      const { data } = await api.post("/products/import/commit", fd);
      setResult(data);
      onImported();
    } catch (err) {
      toast.error(formatApiError(err, t("importFailed")));
    } finally {
      setLoading(false);
    }
  };

  const writable = summary ? summary.new + summary.update : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="dark bg-slate-800/95 backdrop-blur border-slate-700/50 text-slate-100 max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl" data-testid="import-modal">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" /> {t("importTitle")}
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="text-center py-6" data-testid="import-result">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
            <p className="text-lg font-bold text-slate-100 mb-4">{t("importDone")}</p>
            <div className="flex justify-center gap-3 text-sm">
              <span className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 font-semibold">{result.new} {t("importCreated")}</span>
              <span className="px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 font-semibold">{result.update} {t("importUpdated")}</span>
              <span className="px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 font-semibold">{result.duplicate} {t("importSkipped")}</span>
              <span className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 font-semibold">{result.invalid} {t("importSummaryInvalid")}</span>
            </div>
            <button data-testid="import-close-btn" onClick={close}
              className="mt-6 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors">
              {t("cancel") === "cancel" ? "Close" : "إغلاق"}
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-400 mb-4">{t("importDesc")}</p>
            <div className="flex flex-col sm:flex-row gap-3 mb-5">
              <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" data-testid="import-file-input"
                onChange={(e) => pickFile(e.target.files?.[0])} />
              <button data-testid="import-choose-file" onClick={() => fileRef.current?.click()}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-slate-600 text-sm font-semibold text-slate-300 hover:border-emerald-500 hover:text-emerald-300 transition-colors">
                <Upload className="w-4 h-4" /> {file ? file.name : t("chooseFile")}
              </button>
              <a href={`${process.env.REACT_APP_BACKEND_URL}/api/products/import/template`} download
                data-testid="import-template-link"
                className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-700/50 text-sm font-semibold text-slate-400 hover:text-emerald-300 transition-colors">
                <Download className="w-4 h-4" /> {t("downloadTemplate")}
              </a>
            </div>

            {loading && !summary && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-emerald-400" /></div>}

            {mapping && (
              <div className="mb-5">
                <p className="text-sm font-bold text-slate-200 mb-2">{t("columnMapping")}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {["name", "sku", "category", "unit", "purchase_price", "selling_price", "initial_quantity", "description"].map((f) => (
                    <div key={f}>
                      <label className="text-[11px] text-slate-400 mb-1 block">{t(FIELD_KEY[f])}</label>
                      <select data-testid={`map-${f}`} value={mapping[f] || ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })} className={selectCls}>
                        <option value="">{t("noMap")}</option>
                        {headers.filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <p className="text-sm font-bold text-slate-200 mb-2">{t("strategyLabel")}</p>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    {[["skip", "strategySkip"], ["update", "strategyUpdate"]].map(([v, k]) => (
                      <label key={v} className={`flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-sm cursor-pointer transition-colors ${strategy === v ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" : "border-slate-700/50 text-slate-400"}`}>
                        <input type="radio" name="import-strategy" value={v} checked={strategy === v} onChange={() => setStrategy(v)} className="accent-emerald-500" data-testid={`strategy-${v}`} />
                        {t(k)}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {summary && (
              <>
                <div className="flex flex-wrap gap-2 mb-3" data-testid="import-summary">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs font-bold">{summary.new} {t("importSummaryNew")}</span>
                  <span className="px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-300 text-xs font-bold">{summary.update} {t("importSummaryUpdate")}</span>
                  <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 text-xs font-bold">{summary.duplicate} {t("importSummaryDuplicate")}</span>
                  <span className="px-2.5 py-1 rounded-lg bg-red-500/15 text-red-300 text-xs font-bold">{summary.invalid} {t("importSummaryInvalid")}</span>
                </div>
                <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-700/50 mb-5" data-testid="import-preview-table">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-800">
                      <tr className="text-slate-400 border-b border-slate-700/50">
                        <th className="text-start py-2 px-3 font-medium">{t("rowLabel")}</th>
                        <th className="text-start py-2 px-3 font-medium">{t("fldName")}</th>
                        <th className="text-start py-2 px-3 font-medium">{t("fldSku")}</th>
                        <th className="text-start py-2 px-3 font-medium">{t("fldSellingPrice")}</th>
                        <th className="text-start py-2 px-3 font-medium">{t("fldInitialQty")}</th>
                        <th className="text-start py-2 px-3 font-medium">{t("colStatus")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const s = STATUS_STYLE[r.status];
                        return (
                          <tr key={r.row} className="border-b border-slate-700/30" data-testid={`import-row-${r.row}`}>
                            <td className="py-2 px-3 tabular text-slate-500">{r.row}</td>
                            <td className="py-2 px-3 text-slate-200 max-w-[160px] truncate">{r.values.name || "—"}</td>
                            <td className="py-2 px-3 tabular text-slate-400">{r.values.sku || "—"}</td>
                            <td className="py-2 px-3 tabular text-slate-400">{r.values.selling_price ?? "—"}</td>
                            <td className="py-2 px-3 tabular text-slate-400">{r.values.stock_qty ?? "—"}</td>
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
                <button data-testid="import-commit-btn" onClick={commit} disabled={loading || writable === 0}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20">
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? t("importing") : `${t("commitImport")} (${writable})`}
                </button>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
