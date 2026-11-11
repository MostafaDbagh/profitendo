import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Boxes, AlertTriangle, SlidersHorizontal, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fmtMoney } from "../lib/calculations";
import { fmtDateTime } from "./Sales";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";

const statusBadge = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-100",
  low: "bg-amber-50 text-amber-700 border-amber-100",
  out: "bg-red-50 text-red-600 border-red-100",
};

export default function Inventory() {
  const { t, lang } = useLanguage();
  const { can } = useAuth();
  const fin = can("products.costs");
  const [rows, setRows] = useState(null);
  const [movements, setMovements] = useState([]);
  const [adjustFor, setAdjustFor] = useState(null);
  const [adjForm, setAdjForm] = useState({ movement_type: "ADJUSTMENT", quantity: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data: inv }, { data: movs }] = await Promise.all([
        api.get("/inventory"),
        api.get("/inventory/movements?limit=30"),
      ]);
      setRows(inv);
      setMovements(movs);
    } catch {
      toast.error(t("somethingWrong"));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const submitAdjust = async (e) => {
    e.preventDefault();
    const qty = parseInt(adjForm.quantity, 10);
    if (!qty) return;
    setSaving(true);
    try {
      await api.post("/inventory/adjust", {
        product_id: adjustFor.product_id,
        movement_type: adjForm.movement_type,
        quantity: qty,
        notes: adjForm.notes,
      });
      toast.success(t("movementAdded"));
      setAdjustFor(null);
      setAdjForm({ movement_type: "ADJUSTMENT", quantity: "", notes: "" });
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setSaving(false);
    }
  };

  const lowRows = (rows || []).filter((r) => r.status !== "ok");
  const lowCount = lowRows.length;
  const invValue = (rows || []).reduce((s, r) => s + (r.stock_value || 0), 0);
  const [lowOpen, setLowOpen] = useState(false);

  return (
    <div className="space-y-6 fade-up" data-testid="inventory-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("inventoryTitle")}</h1>
        {fin && rows && (
          <div className="bg-white rounded-xl border border-slate-200 px-5 py-2.5 shadow-sm" data-testid="inventory-value">
            <span className="text-xs text-slate-500">{t("inventoryValue")}: </span>
            <span className="font-bold text-slate-900 tabular">{fmtMoney(invValue)}</span>
          </div>
        )}
      </div>

      {lowCount > 0 && (
        <button type="button" onClick={() => setLowOpen(true)} data-testid="low-stock-alert"
          className="w-full flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5 hover:bg-amber-100/70 transition-colors text-start">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <p className="text-sm font-medium text-amber-800">{t("lowStockTitle")}: {lowCount}</p>
          </div>
          <span className="text-xs font-bold text-amber-700 underline underline-offset-2">{t("lowStockView")}</span>
        </button>
      )}

      {!rows ? (
        <div className="flex items-center justify-center py-20"><div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center" data-testid="inventory-empty">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <Boxes className="w-7 h-7 text-emerald-500" />
          </div>
          <p className="font-semibold text-slate-800">{t("emptyTitle")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto" data-testid="inventory-table">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="text-start font-medium px-5 py-3.5">{t("thProduct")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("currentStock")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("minStockLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("stockStatus")}</th>
                {fin && <th className="text-start font-medium px-5 py-3.5">{t("inventoryValue")}</th>}
                {can("inventory.adjust") && <th className="px-5 py-3.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id} className="border-b border-slate-50" data-testid={`inventory-row-${r.product_id}`}>
                  <td className="px-5 py-3.5">
                    <Link to={`/products/${r.product_id}`} className="font-semibold text-slate-800 hover:text-emerald-700 transition-colors">
                      {r.name}
                    </Link>
                    {r.sku && <p className="text-xs text-slate-400 tabular">{r.sku}</p>}
                  </td>
                  <td className="px-5 py-3.5 tabular font-bold text-slate-900" data-testid={`stock-${r.product_id}`}>{r.stock_qty}</td>
                  <td className="px-5 py-3.5 tabular text-slate-500">{r.minimum_stock_level}</td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${statusBadge[r.status]}`} data-testid={`status-${r.product_id}`}>
                      {t(r.status === "ok" ? "stOk" : r.status === "low" ? "stLow" : "stOut")}
                    </span>
                  </td>
                  {fin && <td className="px-5 py-3.5 tabular text-slate-700">{fmtMoney(r.stock_value || 0)}</td>}
                  {can("inventory.adjust") && (
                    <td className="px-5 py-3.5 text-end">
                      <button data-testid={`adjust-${r.product_id}`} onClick={() => setAdjustFor(r)}
                        className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                        <SlidersHorizontal className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto" data-testid="movements-table">
        <h3 className="font-bold text-slate-900 px-5 pt-5 pb-3">{t("recentMovements")}</h3>
        {movements.length === 0 ? (
          <p className="text-sm text-slate-400 px-5 pb-5">{t("noResults")}</p>
        ) : (
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="text-start font-medium px-5 py-3">{t("timeLabel")}</th>
                <th className="text-start font-medium px-5 py-3">{t("thProduct")}</th>
                <th className="text-start font-medium px-5 py-3">{t("movementType")}</th>
                <th className="text-start font-medium px-5 py-3">{t("qtyChange")}</th>
                <th className="text-start font-medium px-5 py-3">{t("referenceLabel")}</th>
                <th className="text-start font-medium px-5 py-3">{t("byLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.movement_id} className="border-b border-slate-50" data-testid={`movement-${m.movement_id}`}>
                  <td className="px-5 py-3 text-slate-600">{fmtDateTime(m.created_at, lang)}</td>
                  <td className="px-5 py-3 text-slate-700">{m.product_name}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{t(`mv_${m.movement_type}`)}</span>
                  </td>
                  <td className={`px-5 py-3 tabular font-bold ${m.quantity >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {m.quantity >= 0 ? "+" : ""}{m.quantity}
                  </td>
                  <td className="px-5 py-3 text-slate-500 tabular">{m.reference_number || "—"}</td>
                  <td className="px-5 py-3 text-slate-500">{m.user_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={lowOpen} onOpenChange={setLowOpen}>
        <DialogContent data-testid="low-stock-modal" className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" /> {t("lowStockProducts")}
            </DialogTitle>
          </DialogHeader>
          {lowRows.length === 0 ? (
            <p className="text-sm text-slate-500 py-4" data-testid="low-stock-empty">{t("noLowStock")}</p>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1" data-testid="low-stock-table">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="text-start font-medium py-2 pe-3">{t("thProduct")}</th>
                    <th className="text-start font-medium py-2 pe-3">{t("currentStock")}</th>
                    <th className="text-start font-medium py-2 pe-3">{t("minStockLabel")}</th>
                    <th className="text-start font-medium py-2">{t("shortageLabel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lowRows.map((r) => {
                    const shortage = Math.max(0, (r.minimum_stock_level || 0) - (r.stock_qty || 0));
                    return (
                      <tr key={r.product_id} className="border-b border-slate-50" data-testid={`low-stock-row-${r.product_id}`}>
                        <td className="py-2.5 pe-3">
                          <Link to={`/products/${r.product_id}`} data-testid={`low-stock-link-${r.product_id}`}
                            className="font-semibold text-slate-800 hover:text-emerald-700 transition-colors">
                            {r.name}
                          </Link>
                          {r.sku && <p className="text-xs text-slate-400 tabular">{r.sku}</p>}
                        </td>
                        <td className="py-2.5 pe-3 tabular font-bold text-slate-900">{r.stock_qty}</td>
                        <td className="py-2.5 pe-3 tabular text-slate-500">{r.minimum_stock_level}</td>
                        <td className="py-2.5 tabular font-bold text-red-600">{shortage > 0 ? `-${shortage}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!adjustFor} onOpenChange={(o) => !o && setAdjustFor(null)}>
        <DialogContent data-testid="adjust-dialog">
          <DialogHeader>
            <DialogTitle>{t("adjustStock")} — {adjustFor?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitAdjust} className="space-y-4" data-testid="adjust-form">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("movementType")}</label>
              <select data-testid="adjust-type-select" value={adjForm.movement_type}
                onChange={(e) => setAdjForm((f) => ({ ...f, movement_type: e.target.value }))} className={inputCls}>
                <option value="ADJUSTMENT">{t("mv_ADJUSTMENT")}</option>
                <option value="DAMAGE">{t("mv_DAMAGE")}</option>
                <option value="MANUAL_CORRECTION">{t("mv_MANUAL_CORRECTION")}</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("adjustQty")}</label>
              <input data-testid="adjust-qty-input" type="number" step="1" required value={adjForm.quantity}
                onChange={(e) => setAdjForm((f) => ({ ...f, quantity: e.target.value }))} className={`${inputCls} tabular`} />
              <p className="text-xs text-slate-400 mt-1">{t("currentStock")}: {adjustFor?.stock_qty}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("notesLabel")}</label>
              <input data-testid="adjust-notes-input" value={adjForm.notes}
                onChange={(e) => setAdjForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls} />
            </div>
            <button data-testid="adjust-submit-btn" type="submit" disabled={saving || !adjForm.quantity}
              className="w-full py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("adjustStock")}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
