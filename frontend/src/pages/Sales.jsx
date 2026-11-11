import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, ShoppingCart, XCircle, Pencil, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fmtMoney } from "../lib/calculations";
import { getRegionalPrefs } from "../lib/locale";
import EditPinModal from "../components/EditPinModal";
import { ImportSalesModal } from "../components/sales/ImportSalesModal";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";

export function fmtDateTime(iso, lang) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const prefs = getRegionalPrefs();
    const pad = (n) => String(n).padStart(2, "0");
    const dd = pad(d.getDate());
    const mm = pad(d.getMonth() + 1);
    const yyyy = d.getFullYear();
    const date = prefs.date_format === "mdy" ? `${mm}/${dd}/${yyyy}`
      : prefs.date_format === "ymd" ? `${yyyy}-${mm}-${dd}`
      : `${dd}/${mm}/${yyyy}`;
    const time = new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en-US", { hour: "2-digit", minute: "2-digit" }).format(d);
    return `${date} · ${time}`;
  } catch { return iso; }
}

export default function Sales() {
  const { t, lang } = useLanguage();
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const fin = can("products.costs") && can("finance.profit") && can("finance.margin");
  const [sales, setSales] = useState(null);
  const [toCancel, setToCancel] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const editMode = user?.business?.pin_enabled ? "pin" : user?.has_password ? "password" : "setup";
  const startEdit = (s) => setEditTarget(s);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/sales");
      setSales(data);
    } catch {
      toast.error(t("somethingWrong"));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const cancelSale = async () => {
    try {
      await api.post(`/sales/${toCancel.sale_id}/cancel`);
      toast.success(t("saleCancelledMsg"));
      setToCancel(null);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || t("somethingWrong"));
      setToCancel(null);
    }
  };

  return (
    <div className="space-y-6 fade-up" data-testid="sales-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("salesTitle")}</h1>
        <div className="flex flex-wrap gap-2.5">
          <a href={`${process.env.REACT_APP_BACKEND_URL}/api/sales/export.xlsx`} download data-testid="export-sales-btn"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700 font-semibold text-sm transition-colors bg-white">
            <Download className="w-4 h-4" /> {t("exportSales")}
          </a>
          {can("sales.create") && (
            <button onClick={() => setImportOpen(true)} data-testid="import-sales-btn"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-emerald-500/40 text-emerald-600 hover:bg-emerald-50 font-semibold text-sm transition-colors">
              <Upload className="w-4 h-4" /> {t("importSales")}
            </button>
          )}
          {can("sales.create") && (
            <Link to="/sales/new" data-testid="new-sale-btn"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors">
              <Plus className="w-4 h-4" /> {t("newSale")}
            </Link>
          )}
        </div>
      </div>

      {!sales ? (
        <div className="flex items-center justify-center py-20"><div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" /></div>
      ) : sales.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center" data-testid="sales-empty">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <ShoppingCart className="w-7 h-7 text-emerald-500" />
          </div>
          <p className="font-semibold text-slate-800">{t("noSales")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto" data-testid="sales-table">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="text-start font-medium px-5 py-3.5">{t("saleNumber")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("dateLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("customer")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("paymentMethod")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("grandTotal")}</th>
                {fin && <th className="text-start font-medium px-5 py-3.5">{t("profitLabel")}</th>}
                <th className="text-start font-medium px-5 py-3.5">{t("statusLabel")}</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.sale_id} className="border-b border-slate-50" data-testid={`sale-row-${s.sale_id}`}>
                  <td className="px-5 py-3.5 font-semibold text-slate-800 tabular">{s.sale_number}</td>
                  <td className="px-5 py-3.5 text-slate-600">{fmtDateTime(s.date, lang)}</td>
                  <td className="px-5 py-3.5 text-slate-600">{s.customer || "—"}</td>
                  <td className="px-5 py-3.5 text-slate-600">{t(`pm${s.payment_method.charAt(0).toUpperCase()}${s.payment_method.slice(1)}`)}</td>
                  <td className="px-5 py-3.5 tabular font-semibold text-slate-800">{fmtMoney(s.total)}</td>
                  {fin && (
                    <td className={`px-5 py-3.5 tabular font-semibold ${s.profit < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {fmtMoney(s.profit)}
                    </td>
                  )}
                  <td className="px-5 py-3.5">
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${s.status === "confirmed" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                      {s.status === "confirmed" ? t("statusConfirmed") : t("statusCancelled")}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-end">
                    <div className="inline-flex items-center gap-1">
                      {s.status === "confirmed" && can("sales.edit") && (
                        <button data-testid={`edit-sale-${s.sale_id}`} onClick={() => startEdit(s)} title={t("edit")}
                          className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {s.status === "confirmed" && can("sales.cancel") && (
                        <button data-testid={`cancel-sale-${s.sale_id}`} onClick={() => setToCancel(s)}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editTarget && (
        <EditPinModal
          invoiceLabel={editTarget.sale_number}
          mode={editMode}
          onClose={() => setEditTarget(null)}
          onSuccess={(pin) => {
            const s = editTarget;
            setEditTarget(null);
            navigate(`/sales/${s.sale_id}/edit`, { state: { pin } });
          }}
        />
      )}

      <AlertDialog open={!!toCancel} onOpenChange={(o) => !o && setToCancel(null)}>
        <AlertDialogContent data-testid="cancel-sale-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelSaleBtn")}؟</AlertDialogTitle>
            <AlertDialogDescription>{toCancel?.sale_number} — {fmtMoney(toCancel?.total || 0)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="cancel-sale-no">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="cancel-sale-yes" onClick={cancelSale} className="bg-red-500 hover:bg-red-600 text-white">
              {t("cancelSaleBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportSalesModal open={importOpen} onClose={() => setImportOpen(false)} onImported={load} />
    </div>
  );
}
