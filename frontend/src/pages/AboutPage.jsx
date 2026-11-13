import MarketingLayout from "../components/landing/MarketingLayout";
import { Audience, HowItWorks } from "../components/landing/marketing";
import { Support, Security, FinalCta } from "../components/landing/conversion";
import { Seo } from "../components/Seo";
import { useLanguage } from "../context/LanguageContext";

export default function AboutPage() {
  const { t } = useLanguage();
  return (
    <MarketingLayout testId="about-page" seo={
      <Seo title={t("seoAboutTitle")} description={t("seoAboutDesc")} path="/about" />
    }>
        <section className="marketing-about-hero" data-testid="about-hero">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-50 leading-tight">{t("aboutHeroTitle")}</h1>
          <div className="marketing-about-story"><p className="text-slate-300 mt-6 leading-relaxed">{t("aboutP1")}</p>
          <p className="text-slate-400 mt-4 leading-relaxed">{t("aboutP2")}</p></div>
        </section>
        <Audience />
        <HowItWorks />
        <Security />
        <Support />
        <FinalCta />
    </MarketingLayout>
  );
}
