import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Search, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import api from "../../lib/api";
import { fmtMoney } from "../../lib/calculations";
import { useLanguage } from "../../context/LanguageContext";

const inputCls = "px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";
const SRC_STYLE = {
  sale: "bg-emerald-50 text-emerald-700",
  purchase: "bg-sky-50 text-sky-700",
  expense: "bg-rose-50 text-rose-700",
  return: "bg-amber-50 text-amber-700",
};

export const useAcctName = () => {
  const { t } = useLanguage();
  return useCallback((code, name) => {
    const v = t(`acct_${code}`);
    return v === `acct_${code}` ? name : v;
  }, [t]);
};

export function JournalTab() {
  const { t } = useLanguage();
  const acctName = useAcctName();
  const [entries, setEntries] = useState(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [open, setOpen] = useState(null);

  useEffect(() => {
    api.get("/ledger/journal").then(({ data }) => setEntries(data)).catch(() => toast.error(t("somethingWrong")));
  }, [t]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (type && e.source_type !== type) return false;
      if (!q) return true;
      const hay = [e.entry_number, e.source_number, e.narration, ...e.lines.map((l) => `${l.code} ${l.name}`)].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query, type]);

  if (!entries) return <div className="flex justify-center py-14"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>;

  return (
    <div data-testid="journal-tab">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute top-3 start-3" />
          <input data-testid="journal-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchJournal")} className={`${inputCls} w-full ps-9`} />
        </div>
        <select data-testid="journal-type-filter" value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
          <option value="">{t("allTypes")}</option>
          <option value="sale">{t("srcSale")}</option>
          <option value="purchase">{t("srcPurchase")}</option>
          <option value="expense">{t("srcExpense")}</option>
          <option value="return">{t("srcReturn")}</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10" data-testid="journal-empty">{t("noJournalEntries")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-100">
                <th className="text-start py-2 font-medium">{t("colDate")}</th>
                <th className="text-start py-2 font-medium">{t("colRef")}</th>
                <th className="text-start py-2 font-medium">{t("colType")}</th>
                <th className="text-start py-2 font-medium">{t("colDesc")}</th>
                <th className="text-end py-2 font-medium">{t("colDebit")}</th>
                <th className="text-end py-2 font-medium">{t("colCredit")}</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <EntryRows key={e.entry_id} e={e} open={open === e.entry_id} onToggle={() => setOpen(open === e.entry_id ? null : e.entry_id)} t={t} acctName={acctName} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EntryRows({ e, open, onToggle, t, acctName }) {
  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={onToggle} data-testid={`journal-entry-${e.entry_number}`}>
        <td className="py-2.5 tabular text-slate-500 whitespace-nowrap">{String(e.date).slice(0, 10)}</td>
        <td className="py-2.5 tabular font-semibold text-slate-700">{e.entry_number}</td>
        <td className="py-2.5">
          <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${SRC_STYLE[e.source_type] || "bg-slate-100 text-slate-600"}`}>{t(`src${e.source_type.charAt(0).toUpperCase()}${e.source_type.slice(1)}`)}</span>
          {e.kind === "reversal" && <span className="ms-1.5 px-2 py-0.5 rounded-md text-xs font-semibold bg-red-50 text-red-600">{t("kindReversal")}</span>}
          {e.backfilled && <span className="ms-1.5 px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-500">{t("backfilledTag")}</span>}
        </td>
        <td className="py-2.5 text-slate-600 max-w-[220px] truncate">{e.narration}</td>
        <td className="py-2.5 text-end tabular text-slate-700">{fmtMoney(e.total_debit)}</td>
        <td className="py-2.5 text-end tabular text-slate-700">{fmtMoney(e.total_credit)}</td>
        <td className="py-2.5 text-slate-400">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
      </tr>
      {open && (
        <tr data-testid={`journal-lines-${e.entry_number}`}>
          <td colSpan={7} className="bg-slate-50/70 border-b border-slate-100 px-4 py-3">
            <table className="w-full text-xs">
              <tbody>
                {e.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 tabular text-slate-400 w-16">{l.code}</td>
                    <td className="py-1.5 text-slate-700">{acctName(l.code, l.name)}</td>
                    <td className="py-1.5 text-end tabular text-emerald-700 w-28">{l.debit ? fmtMoney(l.debit) : ""}</td>
                    <td className="py-1.5 text-end tabular text-rose-600 w-28">{l.credit ? fmtMoney(l.credit) : ""}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} className="pt-2">
                    <span className="inline-flex items-center gap-1.5 text-emerald-600 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {fmtMoney(e.total_debit)} = {fmtMoney(e.total_credit)} · {t("balancedTag")}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
