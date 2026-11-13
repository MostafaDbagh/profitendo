import MarketingLayout from "../components/landing/MarketingLayout";
import { Pricing, Faq, FinalCta } from "../components/landing/conversion";
import { Seo } from "../components/Seo";
import { useLanguage } from "../context/LanguageContext";

export default function PricingPage() {
  const { t } = useLanguage();
  return (
    <MarketingLayout testId="pricing-page" seo={
      <Seo title={t("seoPricingTitle")} description={t("seoPricingDesc")} path="/pricing" />
    }>
        <Pricing headingLevel="h1" />
        <Faq />
        <FinalCta />
    </MarketingLayout>
  );
}
