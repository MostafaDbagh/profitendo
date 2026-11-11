import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ShoppingBag,
  Boxes,
  Undo2,
  Receipt,
  Wallet,
  Users,
  Handshake,
  BarChart3,
  Settings as SettingsIcon,
  Menu,
  X,
  TrendingUp,
  Languages,
  LogOut,
  Crown,
  BookOpen,
  BookMarked,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import LockScreen from "./LockScreen";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, key: "navDashboard", end: true },
  { to: "/products", icon: Package, key: "navProducts", perm: "products.view" },
  { to: "/sales", icon: ShoppingCart, key: "navSales", perm: "sales.view" },
  { to: "/purchases", icon: ShoppingBag, key: "navPurchases", perm: "purchases.view" },
  { to: "/inventory", icon: Boxes, key: "navInventory", perm: "inventory.view" },
  { to: "/returns", icon: Undo2, key: "navReturns", perm: "returns.view" },
  { to: "/expenses", icon: Receipt, key: "navExpenses", perm: "expenses.view" },
  { to: "/cash", icon: Wallet, key: "navCash", perm: "cash.view" },
  { to: "/employees", icon: Users, key: "navEmployees", perm: "employees.view" },
  { to: "/partners", icon: Handshake, key: "navPartners", perm: "partners.view" },
  { to: "/reports", icon: BarChart3, key: "navReports", anyPerm: ["sales.view", "purchases.view", "inventory.view", "returns.view", "expenses.view", "finance.reports", "cash.view"] },
  { to: "/accounts", icon: BookOpen, key: "navAccounts", perm: "accounts.view" },
  { to: "/ledger", icon: BookMarked, key: "navLedger", perm: "accounts.view" },
  { to: "/settings", icon: SettingsIcon, key: "navSettings" },
  { to: "/subscription", icon: Crown, key: "navSubscription", ownerOnly: true },
];

function Brand() {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-3" data-testid="brand-logo">
      <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shadow-sm">
        <TrendingUp className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="font-bold text-lg leading-tight text-slate-900">{t("appName")}</p>
        <p className="text-xs text-slate-500">{t("tagline")}</p>
      </div>
    </div>
  );
}

function NavLinks({ onNavigate, can, isOwner }) {
  const { t } = useLanguage();
  const visible = navItems.filter((item) => {
    if (item.ownerOnly) return isOwner;
    if (item.anyPerm) return item.anyPerm.some((k) => can(k));
    return !item.perm || can(item.perm);
  });
  return (
    <nav className="flex flex-col gap-1" data-testid="main-nav">
      {visible.map(({ to, icon: Icon, key, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          data-testid={`nav-${key}`}
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors duration-150 ${
              isActive
                ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-transparent"
            }`
          }
        >
          <Icon className="w-5 h-5" />
          {t(key)}
        </NavLink>
      ))}
    </nav>
  );
}

function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();
  const next = lang === "ar" ? "en" : "ar";
  return (
    <button
      data-testid="language-switcher"
      onClick={() => setLang(next)}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors duration-150"
    >
      <Languages className="w-4 h-4" />
      {next === "ar" ? "العربية" : "English"}
    </button>
  );
}

function InactivityLock({ timeoutMin }) {
  const [locked, setLocked] = useState(false);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if (!timeoutMin) return undefined;
    const reset = () => {
      lastActivity.current = Date.now();
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    const iv = setInterval(() => {
      if (Date.now() - lastActivity.current > timeoutMin * 60000) setLocked(true);
    }, 10000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      clearInterval(iv);
    };
  }, [timeoutMin]);

  if (!locked) return null;
  return (
    <LockScreen
      onUnlock={() => {
        lastActivity.current = Date.now();
        setLocked(false);
      }}
    />
  );
}

export default function Layout() {
  const { user, checked, logout, can } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Lock body scroll while the mobile drawer is open (iOS-safe), restore position on close
  useEffect(() => {
    if (!mobileOpen) return;
    const scrollY = window.scrollY;
    const body = document.body;
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.overflow = "";
      window.scrollTo(0, scrollY);
    };
  }, [mobileOpen]);

  const handleLogout = async () => {
    await logout();
    navigate("/auth", { replace: true, state: null });
  };

  if (!checked && !location.state?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="auth-loading">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }
  const effectiveUser = user || location.state?.user;
  if (!effectiveUser) return <Navigate to="/auth" replace />;
  if (effectiveUser.business && !effectiveUser.business.setup_completed) {
    return <Navigate to="/setup" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex" data-testid="app-layout">
      <InactivityLock timeoutMin={effectiveUser.business?.lock_timeout_minutes || 0} />
      <aside className="hidden md:flex w-72 flex-col bg-white border-e border-slate-200 sticky top-0 h-screen max-h-screen overflow-y-auto overscroll-contain p-6 gap-8" data-testid="desktop-sidebar">
        <Brand />
        <NavLinks can={can} isOwner={effectiveUser?.role === "OWNER"} />
        <div className="mt-auto flex flex-col gap-4">
          <div className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
              {(effectiveUser.name || effectiveUser.email || "U").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate" data-testid="sidebar-user-name">
                {t("greeting", { name: (effectiveUser.name || "").split(" ")[0] })}
              </p>
              <p className="text-xs text-slate-500 truncate">{effectiveUser.business?.name || effectiveUser.email}</p>
            </div>
          </div>
          <button
            data-testid="logout-btn"
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors duration-150"
          >
            <LogOut className="w-4 h-4 rtl:-scale-x-100" />
            {t("logout")}
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" data-testid="mobile-nav-overlay">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 start-0 w-72 bg-white p-6 flex flex-col gap-8 shadow-xl overflow-y-auto overscroll-contain" style={{ touchAction: "pan-y" }}>
            <div className="flex items-center justify-between">
              <Brand />
              <button
                data-testid="mobile-nav-close"
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <NavLinks onNavigate={() => setMobileOpen(false)} can={can} isOwner={effectiveUser?.role === "OWNER"} />
            <button
              data-testid="logout-btn-mobile"
              onClick={handleLogout}
              className="mt-auto flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors duration-150"
            >
              <LogOut className="w-4 h-4 rtl:-scale-x-100" />
              {t("logout")}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-slate-200 px-4 md:px-8 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              data-testid="mobile-nav-open"
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-2 rounded-lg hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="md:hidden">
              <Brand />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              data-testid="switch-user-btn"
              onClick={handleLogout}
              title={t("switchUser")}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors duration-150"
            >
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">{t("switchUser")}</span>
            </button>
            <LanguageSwitcher />
          </div>
        </header>
        <main className="flex-1 px-4 md:px-8 py-6 md:py-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
