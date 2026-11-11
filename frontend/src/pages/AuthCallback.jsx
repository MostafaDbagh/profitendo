import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function AuthCallback() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const sessionId =
      (location.hash.includes("session_id=") && location.hash.split("session_id=")[1]?.split("&")[0]) ||
      (location.search.includes("session_id=") && location.search.split("session_id=")[1]?.split("&")[0]);
    if (!sessionId) {
      navigate("/auth", { replace: true });
      return;
    }
    (async () => {
      try {
        const { data } = await api.post("/auth/google/session", null, {
          headers: { "X-Session-ID": sessionId },
        });
        window.history.replaceState(null, "", window.location.pathname);
        setUser(data);
        navigate("/", { replace: true, state: { user: data } });
      } catch {
        navigate("/auth", { replace: true });
      }
    })();
  }, [location.hash, location.search, navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50" data-testid="auth-callback">
      <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  );
}
