import { LandingNav, Footer } from './chrome';
import './home.css';

/** Shared public shell; keeps marketing styles out of the operational app. */
export default function MarketingLayout({ children, testId, seo }) {
  return <div className="home-page marketing-page min-h-screen" data-testid={testId}>
    {seo}
    <LandingNav light />
    <main>{children}</main>
    <Footer />
  </div>;
}
