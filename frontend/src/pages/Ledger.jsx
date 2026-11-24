import {PageHeader, PageLayout} from '../components/page-layout/PageLayout';
import { useLanguage } from "../context/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { JournalTab } from "../components/ledger/JournalTab";
import { TrialBalanceTab } from "../components/ledger/TrialBalanceTab";
import { IncomeStatementTab } from "../components/ledger/IncomeStatementTab";
import { BalanceSheetTab } from "../components/ledger/BalanceSheetTab";

export default function Ledger() {
  const { t, dir } = useLanguage();
  return (
    <PageLayout as="div" data-testid="ledger-page">
      <PageHeader title={t("ledgerTitle")} heading="h1" titleTestId="ledger-title"/>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6">
        <Tabs defaultValue="journal" dir={dir}>
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
    </PageLayout>
  );
}
