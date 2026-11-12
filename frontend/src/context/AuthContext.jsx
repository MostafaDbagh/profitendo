import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import api from "../lib/api";
import { setRegionalPrefs } from "../lib/locale";
import { setCurrency } from "../lib/calculations";
import { useLanguage } from "./LanguageContext";

const AuthContext = createContext(null);
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000];
const AUTHED_KEY = "pl_was_authed";

export function AuthProvider({ children }) {
  const [user, setUserRaw] = useState(null);
  const [checked, setChecked] = useState(false);
  const [confirmedFor, setConfirmedFor] = useState(null);
  const { t } = useLanguage();

  const setUser = useCallback((u) => {
    if (u) localStorage.setItem(AUTHED_KEY, "1");
    else localStorage.removeItem(AUTHED_KEY);
    setUserRaw(u);
  }, []);

  const checkAuth = useCallback(async (attempt = 0) => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      setChecked(true);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        // genuinely unauthenticated or expired session
        const wasAuthed = localStorage.getItem(AUTHED_KEY);
        if (wasAuthed) toast.error(t("sessionExpired"));
        setUser(false);
        setChecked(true);
      } else if (attempt < RETRY_DELAYS.length) {
        // transient failure (network blip, backend cold start/restart) — retry
        // patiently while route guards keep the loading state up
        setTimeout(() => checkAuth(attempt + 1), RETRY_DELAYS[attempt]);
      } else {
        setUser(false);
        setChecked(true);
      }
    }
  }, [t, setUser]);

  useEffect(() => {
    if(process.env.REACT_APP_B2B_PRIMARY==='true'){setChecked(true);return;}
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    // session_id may arrive in the fragment or the query string.
    const loc = window.location;
    if (loc.hash?.includes("session_id=") || loc.search?.includes("session_id=")) {
      setChecked(true);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (user && user.business?.base_currency) setCurrency(user.business.base_currency);
    if (user && user.business) setRegionalPrefs(user.business);
  }, [user]);

  const can = useCallback((key) => !!user?.permissions?.[key], [user]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    window.history.replaceState(null, "", window.location.pathname);
    setConfirmedFor(null);
    setUser(false);
  }, [setUser]);

  return (
    <AuthContext.Provider value={{ user, setUser, checked, logout, checkAuth, can, confirmedFor, setConfirmedFor }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
