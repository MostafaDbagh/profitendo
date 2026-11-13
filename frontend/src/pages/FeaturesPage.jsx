import MarketingLayout from "../components/landing/MarketingLayout";
import { Modules, Accounting, AiSection, KpiPreview } from "../components/landing/marketing";
import { FinalCta } from "../components/landing/conversion";
import { Seo } from "../components/Seo";
import { useLanguage } from "../context/LanguageContext";

export default function FeaturesPage() {
  const { t } = useLanguage();
  return (
    <MarketingLayout testId="features-page" seo={
      <Seo title={t("seoFeaturesTitle")} description={t("seoFeaturesDesc")} path="/features" />
    }>
        <Modules headingLevel="h1" />
        <Accounting />
        <AiSection />
        <KpiPreview />
        <FinalCta />
    </MarketingLayout>
  );
}
