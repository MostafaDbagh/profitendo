import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { translations } from "../i18n";
import api from "../lib/api";

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    const path = window.location.pathname.replace(/\/$/, "") || "/";
    if (["/en", "/en/features", "/en/pricing", "/en/about"].includes(path)) return "en";
    if (["/", "/features", "/pricing", "/about"].includes(path)) return "ar";
    return localStorage.getItem("profitlens_lang") === "en" ? "en" : "ar";
  });
  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    localStorage.setItem("profitlens_lang", lang);
  }, [lang, dir]);

  const setLang = useCallback((l, persistToServer = true) => {
    setLangState(l);
    if (persistToServer) {
      api.put("/auth/language", { language: l }).catch(() => {});
    }
  }, []);

  const t = useCallback(
    (key, vars) => {
      let s = translations[lang]?.[key] ?? translations.en[key] ?? key;
      if (vars) {
        Object.entries(vars).forEach(([k, v]) => {
          s = s.replace(`{${k}}`, v);
        });
      }
      return s;
    },
    [lang]
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, dir }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
