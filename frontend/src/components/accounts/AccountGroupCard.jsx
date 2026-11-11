import { BookOpen } from "lucide-react";
import { AccountRow } from "./AccountRow";

const DEBIT_GROUPS = ["assets", "expenses", "cost_of_sales"];

export function AccountGroupCard({ group, rows, depthOf, acctName, manage, t, onEdit, onToggle, onDelete }) {
  const isDebit = DEBIT_GROUPS.includes(group);
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden" data-testid={`account-group-${group}`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-emerald-500" />
          <h2 className="font-bold text-slate-800">{t(`acctGroup_${group}`)}</h2>
          <span className="text-xs text-slate-400 tabular">{rows.length}</span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isDebit ? "bg-sky-50 text-sky-600" : "bg-violet-50 text-violet-600"}`}>
          {isDebit ? t("natureDebit") : t("natureCredit")}
        </span>
      </div>
      <div className="divide-y divide-slate-50">
        {rows.map((a) => (
          <AccountRow
            key={a.account_id}
            account={a}
            depth={depthOf[a.account_id] || 0}
            name={acctName(a)}
            manage={manage}
            t={t}
            onEdit={onEdit}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
