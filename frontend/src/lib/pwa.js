import { useEffect, useState } from "react";

export function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone();
}

const DISMISS_KEY = "profitlens_pwa_dismissed_at";
const DISMISS_DAYS = 14;

export function installDismissed() {
  const ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return ts > 0 && Date.now() - ts < DISMISS_DAYS * 86400000;
}

export function dismissInstall() {
  localStorage.setItem(DISMISS_KEY, String(Date.now()));
}

export function registerServiceWorker({ onUpdate } = {}) {
  if (!("serviceWorker" in navigator)) return;
  // Development bundles must never be served by an old offline shell.
  if (process.env.NODE_ENV !== "production") {
    navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(
      registrations.filter(reg => reg.active?.scriptURL === `${window.location.origin}/service-worker.js`).map(reg => reg.unregister())
    )).catch(() => {});
    return;
  }
  const register = () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              onUpdate && onUpdate(reg);
            }
          });
        });
      })
      .catch(() => {});
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

export function applyServiceWorkerUpdate(reg) {
  if (reg && reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
}
