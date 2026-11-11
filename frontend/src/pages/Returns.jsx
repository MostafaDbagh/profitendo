import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Undo2, XCircle, Pencil } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fmtMoney } from "../lib/calculations";
import { fmtDateTime } from "./Sales";
import EditPinModal from "../components/EditPinModal";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";

const REASON_KEYS = {
  changed_mind: "rChangedMind",
  damaged: "rDamaged",
  wrong_product: "rWrongProduct",
  defect: "rDefect",
  other: "rOther",
};

export default function Returns() {
  const { t, lang } = useLanguage();
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [returns, setReturns] = useState(null);
  const [toCancel, setToCancel] = useState(null);
  const [editTarget, setEditTarget] = useState(null);

  const editMode = user?.business?.pin_enabled ? "pin" : user?.has_password ? "password" : "setup";
  const startEdit = (r) => setEditTarget(r);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/returns");
      setReturns(data);
    } catch {
      toast.error(t("somethingWrong"));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const cancelReturn = async () => {
    try {
      await api.post(`/returns/${toCancel.return_id}/cancel`);
      toast.success(t("returnCancelled"));
      setToCancel(null);
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
      setToCancel(null);
    }
  };

  return (
    <div className="space-y-6 fade-up" data-testid="returns-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("returnsTitle")}</h1>
        {can("returns.create") && (
          <Link to="/returns/new" data-testid="new-return-btn"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors">
            <Plus className="w-4 h-4" /> {t("newReturn")}
          </Link>
        )}
      </div>

      {!returns ? (
        <div className="flex items-center justify-center py-20"><div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" /></div>
      ) : returns.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center" data-testid="returns-empty">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <Undo2 className="w-7 h-7 text-emerald-500" />
          </div>
          <p className="font-semibold text-slate-800">{t("noReturns")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto" data-testid="returns-table">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="text-start font-medium px-5 py-3.5">{t("returnNumber")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("dateLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("saleNumber")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("itemsLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("reasonLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("refundTotalLabel")}</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.return_id} className="border-b border-slate-50" data-testid={`return-row-${r.return_id}`}>
                  <td className="px-5 py-3.5 font-semibold text-slate-800 tabular">{r.return_number}</td>
                  <td className="px-5 py-3.5 text-slate-600">{fmtDateTime(r.return_date, lang)}</td>
                  <td className="px-5 py-3.5 text-slate-500 tabular">{r.sale_number || "—"}</td>
                  <td className="px-5 py-3.5 text-slate-600">{r.items.map((i) => `${i.name} ×${i.quantity}`).join("، ")}</td>
                  <td className="px-5 py-3.5 text-slate-600">{t(REASON_KEYS[r.reason] || "rOther")}</td>
                  <td className="px-5 py-3.5 tabular font-semibold text-red-600">
                    {fmtMoney(r.refund_total)}
                    {r.status === "cancelled" && (
                      <span className="ms-2 text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{t("statusCancelled")}</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-end">
                    <div className="inline-flex items-center gap-1">
                      {r.status !== "cancelled" && can("returns.edit") && (
                        <button data-testid={`edit-return-${r.return_id}`} onClick={() => startEdit(r)} title={t("edit")}
                          className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {r.status !== "cancelled" && can("returns.cancel") && (
                        <button data-testid={`cancel-return-${r.return_id}`} onClick={() => setToCancel(r)}
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
          invoiceLabel={editTarget.return_number}
          mode={editMode}
          onClose={() => setEditTarget(null)}
          onSuccess={(pin) => {
            const r = editTarget;
            setEditTarget(null);
            navigate(`/returns/${r.return_id}/edit`, { state: { pin } });
          }}
        />
      )}

      <AlertDialog open={!!toCancel} onOpenChange={(o) => !o && setToCancel(null)}>
        <AlertDialogContent data-testid="cancel-return-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelReturn")}؟</AlertDialogTitle>
            <AlertDialogDescription>
              {toCancel?.return_number} — {fmtMoney(toCancel?.refund_total || 0)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="cancel-return-no">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="cancel-return-yes" onClick={cancelReturn} className="bg-red-500 hover:bg-red-600 text-white">
              {t("cancelReturn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
