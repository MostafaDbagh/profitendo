import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, ShoppingBag, XCircle, Pencil, Undo2, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fmtMoney } from "../lib/calculations";
import { specUnitLabel } from "../i18n";
import EditPinModal from "../components/EditPinModal";
import { PurchaseReturnModal } from "../components/purchases/PurchaseReturnModal";
import { ImportPurchasesModal } from "../components/purchases/ImportPurchasesModal";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";

export default function Purchases() {
  const { t, lang } = useLanguage();
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [purchases, setPurchases] = useState(null);
  const [productUnits, setProductUnits] = useState({});
  const [toCancel, setToCancel] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnPreselect, setReturnPreselect] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("return") === "1") setReturnOpen(true);
  }, [searchParams]);

  const editMode = user?.business?.pin_enabled ? "pin" : user?.has_password ? "password" : "setup";
  const startEdit = (p) => setEditTarget(p);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/purchases");
      setPurchases(data);
    } catch {
      toast.error(t("somethingWrong"));
    }
    api.get("/products").then(({ data }) => {
      const map = {};
      data.forEach((p) => { if (p.spec_unit) map[p.product_id] = p.spec_unit; });
      setProductUnits(map);
    }).catch(() => {});
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const cancelPurchase = async () => {
    try {
      await api.post(`/purchases/${toCancel.purchase_id}/cancel`);
      toast.success(t("purchaseCancelled"));
      setToCancel(null);
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
      setToCancel(null);
    }
  };

  const fmtDate = (iso) => {
    if (!iso) return "—";
    try {
      return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(iso));
    } catch { return iso; }
  };

  return (
    <div className="space-y-6 fade-up" data-testid="purchases-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("purchasesTitle")}</h1>
        <div className="flex flex-wrap gap-2.5">
          <a href={`${process.env.REACT_APP_BACKEND_URL}/api/purchases/export.xlsx`} download data-testid="export-purchases-btn"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700 font-semibold text-sm transition-colors bg-white">
            <Download className="w-4 h-4" /> {t("exportPurchases")}
          </a>
          {can("purchases.create") && (
            <button onClick={() => setImportOpen(true)} data-testid="import-purchases-btn"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-emerald-500/40 text-emerald-600 hover:bg-emerald-50 font-semibold text-sm transition-colors">
              <Upload className="w-4 h-4" /> {t("importPurchases")}
            </button>
          )}
          {can("purchases.create") && (
            <Link to="/purchases/new" data-testid="new-purchase-btn"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors">
              <Plus className="w-4 h-4" /> {t("newPurchase")}
            </Link>
          )}
        </div>
      </div>

      {!purchases ? (
        <div className="flex items-center justify-center py-20"><div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" /></div>
      ) : purchases.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center" data-testid="purchases-empty">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <ShoppingBag className="w-7 h-7 text-emerald-500" />
          </div>
          <p className="font-semibold text-slate-800">{t("noPurchases")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto" data-testid="purchases-table">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="text-start font-medium px-5 py-3.5">{t("purchaseNumber")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("supplier")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("invoiceNumber")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("purchaseDate")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("itemsLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("grandTotal")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("byLabel")}</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.purchase_id} className="border-b border-slate-50" data-testid={`purchase-row-${p.purchase_id}`}>
                  <td className="px-5 py-3.5 font-semibold text-slate-800 tabular">{p.purchase_number}</td>
                  <td className="px-5 py-3.5 text-slate-700">{p.supplier}</td>
                  <td className="px-5 py-3.5 text-slate-500 tabular">{p.invoice_number || "—"}</td>
                  <td className="px-5 py-3.5 text-slate-600">{fmtDate(p.purchase_date)}</td>
                  <td className="px-5 py-3.5 text-slate-600 max-w-xs" data-testid={`purchase-items-${p.purchase_id}`}>
                    <div className="space-y-1">
                      {p.items.map((it, j) => {
                        const unit = specUnitLabel(productUnits[it.product_id], t);
                        return (
                          <div key={j} className="flex items-baseline gap-1.5 text-xs leading-5">
                            <span className="font-medium text-slate-700 truncate">{it.name}</span>
                            <span className="text-slate-400 tabular whitespace-nowrap">
                              × {it.quantity}{unit ? ` ${unit}` : ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 tabular font-semibold text-slate-800">{fmtMoney(p.total)}</td>
                  <td className="px-5 py-3.5 text-slate-500">
                    {p.created_by_name}
                    {p.status === "cancelled" && (
                      <span className="ms-2 text-xs font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">{t("statusCancelled")}</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-end">
                    <div className="inline-flex items-center gap-1">
                      {p.status === "confirmed" && can("purchases.edit") && (
                        <button data-testid={`edit-purchase-${p.purchase_id}`} onClick={() => startEdit(p)} title={t("edit")}
                          className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {p.status === "confirmed" && can("purchases.create") && (
                        <button data-testid={`return-purchase-${p.purchase_id}`} title={t("prBtn")}
                          onClick={() => { setReturnPreselect(p.purchase_id); setReturnOpen(true); }}
                          className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                          <Undo2 className="w-4 h-4" />
                        </button>
                      )}
                      {p.status === "confirmed" && can("purchases.cancel") && (
                        <button data-testid={`cancel-purchase-${p.purchase_id}`} onClick={() => setToCancel(p)}
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

      {editTarget && (        <EditPinModal
          invoiceLabel={editTarget.purchase_number}
          mode={editMode}
          onClose={() => setEditTarget(null)}
          onSuccess={(pin) => {
            const p = editTarget;
            setEditTarget(null);
            navigate(`/purchases/${p.purchase_id}/edit`, { state: { pin } });
          }}
        />
      )}

      <AlertDialog open={!!toCancel} onOpenChange={(o) => !o && setToCancel(null)}>
        <AlertDialogContent data-testid="cancel-purchase-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelPurchase")}؟</AlertDialogTitle>
            <AlertDialogDescription>
              {toCancel?.purchase_number} — {fmtMoney(toCancel?.total || 0)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="cancel-purchase-no">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="cancel-purchase-yes" onClick={cancelPurchase} className="bg-red-500 hover:bg-red-600 text-white">
              {t("cancelPurchase")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PurchaseReturnModal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        purchases={purchases || []}
        preselect={returnPreselect}
        onDone={load}
      />

      <ImportPurchasesModal open={importOpen} onClose={() => setImportOpen(false)} onImported={load} />
    </div>
  );
}
