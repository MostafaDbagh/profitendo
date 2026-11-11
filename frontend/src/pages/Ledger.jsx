import { BookMarked } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { JournalTab } from "../components/ledger/JournalTab";
import { TrialBalanceTab } from "../components/ledger/TrialBalanceTab";
import { IncomeStatementTab } from "../components/ledger/IncomeStatementTab";
import { BalanceSheetTab } from "../components/ledger/BalanceSheetTab";

export default function Ledger() {
  const { t } = useLanguage();
  return (
    <div className="space-y-6" data-testid="ledger-page">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-emerald-500 flex items-center justify-center shadow-sm">
          <BookMarked className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900" data-testid="ledger-title">{t("ledgerTitle")}</h1>
          <p className="text-sm text-slate-500">{t("ledgerSubtitle")}</p>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6">
        <Tabs defaultValue="journal" dir="rtl">
          <TabsList className="mb-5" data-testid="ledger-tabs">
            <TabsTrigger value="journal" data-testid="tab-journal">{t("tabJournal")}</TabsTrigger>
            <TabsTrigger value="trial-balance" data-testid="tab-trial-balance">{t("tabTrialBalance")}</TabsTrigger>
            <TabsTrigger value="income" data-testid="tab-income">{t("tabIncome")}</TabsTrigger>
            <TabsTrigger value="balance-sheet" data-testid="tab-balance-sheet">{t("tabBalanceSheet")}</TabsTrigger>
          </TabsList>
          <TabsContent value="journal"><JournalTab /></TabsContent>
          <TabsContent value="trial-balance"><TrialBalanceTab /></TabsContent>
          <TabsContent value="income"><IncomeStatementTab /></TabsContent>
          <TabsContent value="balance-sheet"><BalanceSheetTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
