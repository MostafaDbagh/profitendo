import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { useLanguage } from "../../context/LanguageContext";
import { fmtMoney } from "../../lib/calculations";
import { useInvoiceDraft } from "../../lib/draft";
import { DraftStatus } from "../DraftStatus";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";

export function PurchaseReturnModal({ open, onClose, purchases, preselect, onDone }) {
  const { t } = useLanguage();
  const [purchaseId, setPurchaseId] = useState("");
  const [qtys, setQtys] = useState({});
  const [refundMethod, setRefundMethod] = useState("cash");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const clientRef = useRef(crypto.randomUUID());

  const draftSnapshot = useMemo(() => ({ purchaseId, qtys, refundMethod, reason }), [purchaseId, qtys, refundMethod, reason]);
  const draftDirty = !!purchaseId && Object.values(qtys).some((q) => q > 0);
  const { status: draftStatus, clearDraft } = useInvoiceDraft("purchase_return", draftSnapshot, {
    enabled: open && !preselect,
    dirty: draftDirty,
    onRestore: (p) => {
      setPurchaseId(p.purchaseId || "");
      setQtys(p.qtys || {});
      setRefundMethod(p.refundMethod || "cash");
      setReason(p.reason || "");
      if (p.purchaseId) toast.success(t("draftRestored"));
    },
  });

  const confirmed = (purchases || []).filter((p) => p.status === "confirmed");

  useEffect(() => {
    if (open) {
      setPurchaseId(preselect || "");
      setQtys({});
      setReason("");
      setRefundMethod("cash");
    }
  }, [open, preselect]);

  const purchase = confirmed.find((p) => p.purchase_id === purchaseId);
  const maxFor = (l) => l.quantity - (l.returned_qty || 0);
  const totalValue = purchase
    ? purchase.items.reduce((s, l) => s + Math.min(qtys[l.product_id] || 0, maxFor(l)) * (l.unit_cost || 0), 0)
    : 0;

  const submit = async () => {
    const items = Object.entries(qtys)
      .filter(([, q]) => q > 0)
      .map(([product_id, q]) => ({ product_id, quantity: q }));
    if (!purchaseId || items.length === 0) return;
    setLoading(true);
    try {
      await api.post("/purchase-returns", { purchase_id: purchaseId, items, reason, refund_method: refundMethod, client_ref: clientRef.current });
      toast.success(t("prSuccess"));
      await clearDraft();
      onDone();
      onClose();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-white border-slate-200 max-w-xl max-h-[85vh] overflow-y-auto" dir="rtl" data-testid="purchase-return-modal">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Undo2 className="w-5 h-5 text-emerald-600" /> {t("prTitle")}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500 mb-4">{t("prDesc")}</p>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("prSelectPurchase")}</label>
            <select data-testid="pr-purchase-select" value={purchaseId} onChange={(e) => { setPurchaseId(e.target.value); setQtys({}); }} className={inputCls}>
              <option value="">—</option>
              {confirmed.map((p) => (
                <option key={p.purchase_id} value={p.purchase_id}>{p.purchase_number} · {p.supplier}</option>
              ))}
            </select>
          </div>

          {purchase && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 border-b border-slate-100 bg-slate-50/60">
                    <th className="text-start py-2 px-3 font-medium">{t("colProduct")}</th>
                    <th className="text-center py-2 px-2 font-medium">{t("prPurchased")}</th>
                    <th className="text-center py-2 px-2 font-medium">{t("prAlreadyReturned")}</th>
                    <th className="text-center py-2 px-2 font-medium">{t("prOriginalCost")}</th>
                    <th className="text-center py-2 px-2 font-medium w-28">{t("prReturnQty")}</th>
                  </tr>
                </thead>
                <tbody>
                  {purchase.items.map((l) => (
                    <tr key={l.product_id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 px-3 text-slate-700">{l.product_name}</td>
                      <td className="py-2 px-2 text-center tabular text-slate-500">{l.quantity}</td>
                      <td className="py-2 px-2 text-center tabular text-slate-500">{l.returned_qty || 0}</td>
                      <td className="py-2 px-2 text-center tabular text-slate-500">{fmtMoney(l.unit_cost)}</td>
                      <td className="py-2 px-2">
                        <input data-testid={`pr-qty-${l.product_id}`} type="number" min="0" max={maxFor(l)} step="1"
                          value={qtys[l.product_id] || ""}
                          onChange={(e) => setQtys({ ...qtys, [l.product_id]: Math.min(Math.max(0, Number(e.target.value) || 0), maxFor(l)) })}
                          className={`${inputCls} text-center tabular py-1.5`} placeholder="0" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {purchase && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("prRefundMethod")}</label>
                  <select data-testid="pr-refund-method" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} className={inputCls}>
                    <option value="cash">{t("pmCash")}</option>
                    <option value="card">{t("pmCard")}</option>
                    <option value="transfer">{t("pmTransfer")}</option>
                    <option value="other">{t("pmOther")}</option>
                    <option value="credit">{t("pmCredit")}</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">{t("prReason")}</label>
                  <input data-testid="pr-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} maxLength={200} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                <span className="text-sm font-semibold text-slate-600">{t("colTotal")}</span>
                <span className="text-lg font-extrabold tabular text-slate-900" data-testid="pr-total-value">{fmtMoney(totalValue)}</span>
              </div>
              <div className="flex justify-end"><DraftStatus status={draftStatus} /></div>
              <button data-testid="pr-submit-btn" onClick={submit} disabled={loading || totalValue <= 0}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("prSubmit")}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
