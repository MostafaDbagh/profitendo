import { useCallback, useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useLanguage } from "../context/LanguageContext";
import { fmtDateTime } from "./Sales";

export default function Audit() {
  const { t, lang } = useLanguage();
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    api.get("/audit").then(({ data }) => setLogs(data)).catch(() => toast.error(t("somethingWrong")));
  }, [t]);

  return (
    <div className="space-y-6 fade-up" data-testid="audit-page">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("auditTitle")}</h1>
      {!logs ? (
        <div className="flex items-center justify-center py-20"><div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" /></div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center" data-testid="audit-empty">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <ScrollText className="w-7 h-7 text-emerald-500" />
          </div>
          <p className="font-semibold text-slate-800">{t("noAudit")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto" data-testid="audit-table">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="text-start font-medium px-5 py-3.5">{t("timeLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("name")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("actionLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("entityLabel")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("summaryLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.log_id} className="border-b border-slate-50" data-testid={`audit-row-${l.log_id}`}>
                  <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{fmtDateTime(l.created_at, lang)}</td>
                  <td className="px-5 py-3 text-slate-700 font-medium">{l.user_name}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600" dir="ltr">{l.action}</span>
                  </td>
                  <td className="px-5 py-3 text-slate-500" dir="ltr">{l.entity}</td>
                  <td className="px-5 py-3 text-slate-600">{l.summary || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
