import { useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { Seo } from "../components/Seo";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { AuthBranding, MobileLogo } from "../components/auth/AuthBranding";
import { AuthCard } from "../components/auth/AuthCard";

export default function Auth() {
  const [mode, setMode] = useState(() =>
    new URLSearchParams(window.location.search).get("mode") === "register" ? "register" : "login"
  );
  const [form, setForm] = useState({ name: "", email: "", password: "", username: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  const { user, checked, setUser } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/auth/setup-state")
      .then(({ data }) => { if (data.setup_required) setMode("owner-setup"); })
      .catch(() => {})
      .finally(() => setSetupChecked(true));
  }, []);

  if (checked && user) return <Navigate to="/dashboard" replace />;
  if (!setupChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" data-testid="auth-loading">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    if ((mode === "owner-setup" || mode === "kiosk-setup") && form.password !== form.confirm) {
      toast.error(t("passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      const endpoint =
        mode === "login" ? "/auth/login"
        : mode === "kiosk" ? "/auth/kiosk-login"
        : mode === "owner-setup" ? "/auth/owner-setup"
        : mode === "kiosk-setup" ? "/auth/kiosk-set-password"
        : "/auth/register";
      const payload =
        mode === "kiosk" || mode === "owner-setup" || mode === "kiosk-setup"
          ? { username: form.username, password: form.password }
          : { name: form.name, email: form.email, password: form.password };
      const { data } = await api.post(endpoint, payload);
      setUser(data);
      if (data.language && data.language !== lang) setLang(data.language, false);
      toast.success(`${t("welcome")}, ${data.name}`);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (mode === "kiosk" && err?.response?.data?.detail === "PASSWORD_SETUP_REQUIRED") {
        setForm((f) => ({ ...f, password: "", confirm: "" }));
        setMode("kiosk-setup");
      } else {
        toast.error(formatApiError(err, t("somethingWrong")));
      }
    } finally {
      setLoading(false);
    }
  };

  const googleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="min-h-screen bg-slate-50 flex relative" data-testid="auth-page">
      <Seo title={t("seoAuthTitle")} description={t("seoAuthDesc")} path="/auth" noindex />
      <button
        data-testid="language-switcher"
        onClick={() => setLang(lang === "ar" ? "en" : "ar")}
        className="absolute top-4 end-4 z-10 px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
      >
        {lang === "ar" ? "English" : "العربية"}
      </button>
      <AuthBranding t={t} />

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md fade-up">
          <MobileLogo t={t} />
          <AuthCard
            mode={mode}
            form={form}
            set={set}
            setForm={setForm}
            setMode={setMode}
            loading={loading}
            onSubmit={submit}
            onGoogle={googleLogin}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}
