import SaleReceiptV2 from "@/pages/SaleReceiptV2";
import "@/App.css";
import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { OfflineBanner, InstallPrompt, UpdateBanner } from "@/components/PwaManager";
import { registerServiceWorker } from "@/lib/pwa";
import { LanguageProvider } from "@/context/LanguageContext";
import Layout from "@/components/Layout";
import Auth from "@/pages/Auth";import ForgotPassword from "@/pages/ForgotPassword";import ResetPassword from "@/pages/ResetPassword";
import AuthV2 from "@/pages/AuthV2";
import BusinessV2 from "@/pages/BusinessV2";
import BillingV2 from "@/pages/BillingV2";
import PlatformV2 from "@/pages/PlatformV2";
import AuthCallback from "@/pages/AuthCallback";
import Setup from "@/pages/Setup";
import Onboarding from "@/pages/Onboarding";
import Landing from "@/pages/Landing";
import FeaturesPage from "@/pages/FeaturesPage";
import PricingPage from "@/pages/PricingPage";
import AboutPage from "@/pages/AboutPage";
import NotFound from "@/pages/NotFound";
import Dashboard from "@/pages/Dashboard";
import Products from "@/pages/Products";
import ProductForm from "@/pages/ProductForm";
import ProductDetails from "@/pages/ProductDetails";
import Sales from "@/pages/Sales";
import SaleNew from "@/pages/SaleNew";
import Purchases from "@/pages/Purchases";
import PurchaseNew from "@/pages/PurchaseNew";
import Returns from "@/pages/Returns";
import ReturnNew from "@/pages/ReturnNew";
import Expenses from "@/pages/Expenses";
import Inventory from "@/pages/Inventory";
import Cash from "@/pages/Cash";
import Employees from "@/pages/Employees";
import Partners from "@/pages/Partners";
import Reports from "@/pages/Reports";
import Accounts from "@/pages/Accounts";import Ledger from "@/pages/Ledger";import Audit from "@/pages/Audit";
import Settings from "@/pages/Settings";
import Subscription from "@/pages/Subscription";

function RequirePerm({ perm, anyOf, children }) {
  const { user } = useAuth();
  const perms = user?.permissions || {};
  if (anyOf && !anyOf.some((k) => perms[k])) return <Navigate to="/dashboard" replace />;
  if (perm && user && !perms[perm]) return <Navigate to="/dashboard" replace />;
  return children;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function AppRouter() {
  const location = useLocation();
  // session_id may arrive in the URL fragment OR the query string depending on
  // browser/provider redirect handling — accept both.
  if (location.hash?.includes("session_id=") || location.search?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <>
    <ScrollToTop />
    <Routes>
      {process.env.REACT_APP_AUTH_API_URL && <><Route path="/auth-v2" element={<AuthV2 />} /><Route path="/sales-v2/:businessId/:id/receipt" element={<SaleReceiptV2 />} /><Route path="/business-v2" element={<BusinessV2 />} /><Route path="/billing-v2" element={<BillingV2 />} /><Route path="/platform-v2" element={<PlatformV2 />} /></>}
      <Route path="/auth" element={<Auth />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/" element={<Landing />} />
      <Route path="/features" element={<FeaturesPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/products" element={<RequirePerm perm="products.view"><Products /></RequirePerm>} />
        <Route path="/products/new" element={<RequirePerm perm="products.create"><ProductForm /></RequirePerm>} />
        <Route path="/products/:id" element={<RequirePerm perm="products.view"><ProductDetails /></RequirePerm>} />
        <Route path="/products/:id/edit" element={<RequirePerm perm="products.edit"><ProductForm /></RequirePerm>} />
        <Route path="/sales" element={<RequirePerm perm="sales.view"><Sales /></RequirePerm>} />
        <Route path="/sales/new" element={<RequirePerm perm="sales.create"><SaleNew /></RequirePerm>} />
        <Route path="/sales/:id/edit" element={<RequirePerm perm="sales.edit"><SaleNew /></RequirePerm>} />
        <Route path="/purchases" element={<RequirePerm perm="purchases.view"><Purchases /></RequirePerm>} />
        <Route path="/purchases/new" element={<RequirePerm perm="purchases.create"><PurchaseNew /></RequirePerm>} />
        <Route path="/purchases/:id/edit" element={<RequirePerm perm="purchases.edit"><PurchaseNew /></RequirePerm>} />
        <Route path="/returns" element={<RequirePerm perm="returns.view"><Returns /></RequirePerm>} />
        <Route path="/returns/new" element={<RequirePerm perm="returns.create"><ReturnNew /></RequirePerm>} />
        <Route path="/returns/:id/edit" element={<RequirePerm perm="returns.edit"><ReturnNew /></RequirePerm>} />
        <Route path="/expenses" element={<RequirePerm perm="expenses.view"><Expenses /></RequirePerm>} />
        <Route path="/inventory" element={<RequirePerm perm="inventory.view"><Inventory /></RequirePerm>} />
        <Route path="/cash" element={<RequirePerm perm="cash.view"><Cash /></RequirePerm>} />
        <Route path="/employees" element={<RequirePerm perm="employees.view"><Employees /></RequirePerm>} />
        <Route path="/partners" element={<RequirePerm perm="partners.view"><Partners /></RequirePerm>} />
        <Route path="/reports" element={<RequirePerm anyOf={["sales.view", "purchases.view", "inventory.view", "returns.view", "expenses.view", "finance.reports", "cash.view"]}><Reports /></RequirePerm>} />
        <Route path="/accounts" element={<RequirePerm perm="accounts.view"><Accounts /></RequirePerm>} />
        <Route path="/ledger" element={<RequirePerm perm="accounts.view"><Ledger /></RequirePerm>} />
        <Route path="/audit" element={<RequirePerm perm="audit.view"><Audit /></RequirePerm>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/subscription" element={<Subscription />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  );
}

function App() {
  const [swReg, setSwReg] = useState(null);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    registerServiceWorker({ onUpdate: (reg) => { setSwReg(reg); setUpdateReady(true); } });
  }, []);

  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
        <Toaster position="top-center" richColors />
        <OfflineBanner />
        <InstallPrompt />
        {updateReady && <UpdateBanner registration={swReg} onDone={() => setUpdateReady(false)} />}
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;
