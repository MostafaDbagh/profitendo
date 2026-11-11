import { LandingNav, Footer } from "../components/landing/chrome";
import { Modules, Accounting, AiSection, KpiPreview } from "../components/landing/marketing";
import { FinalCta } from "../components/landing/conversion";
import { Seo } from "../components/Seo";
import { useLanguage } from "../context/LanguageContext";

export default function FeaturesPage() {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" data-testid="features-page">
      <Seo title={t("seoFeaturesTitle")} description={t("seoFeaturesDesc")} path="/features" />
      <LandingNav />
      <main>
        <Modules />
        <Accounting />
        <AiSection />
        <KpiPreview />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
