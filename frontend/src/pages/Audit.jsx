import {panelClass} from '../components/page-layout/tokens';
import {EmptyState, LoadingState} from '../components/page-layout/PageResults';
import {PageHeader, PageLayout, TableRegion} from '../components/page-layout/PageLayout';
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
    <PageLayout as="div" className="fade-up" data-testid="audit-page">
      <PageHeader title={t("auditTitle")} heading="h1"/>
      {!logs ? (
        <LoadingState>{t("loading")}</LoadingState>
      ) : logs.length === 0 ? (
        <EmptyState icon={ScrollText} className={panelClass} data-testid="audit-empty">{t("noAudit")}</EmptyState>
      ) : (
        <TableRegion data-testid="audit-table">
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
        </TableRegion>
      )}
    </PageLayout>
  );
}
