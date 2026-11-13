import HomeHero from "../components/landing/HomeHero";
import MarketingLayout from "../components/landing/MarketingLayout";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { Seo } from "../components/Seo";
import { Modules, Accounting, AiSection, KpiPreview, Audience, HowItWorks } from "../components/landing/marketing";
import { Pricing, Security, Faq, Support, FinalCta } from "../components/landing/conversion";

export default function Landing() {
  const { user, checked } = useAuth();
  const { t } = useLanguage();

  if (checked && user) return <Navigate to="/dashboard" replace />;

  if (!checked) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" data-testid="lp-loading">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  return (
    <MarketingLayout testId="landing-page" seo={
      <Seo title={t("seoHomeTitle")} description={t("seoHomeDesc")} path="/" />
    }>
        <HomeHero />
        <Modules />
        <Accounting />
        <AiSection />
        <KpiPreview />
        <Audience />
        <HowItWorks />
        <Pricing />
        <Security />
        <Faq />
        <Support />
        <FinalCta />
    </MarketingLayout>
  );
}
