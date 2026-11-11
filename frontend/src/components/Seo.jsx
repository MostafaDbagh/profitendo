import { useEffect } from "react";

const SITE = "https://profitendo.com";
const DEFAULT_TITLE = "ProfitLens — اعرف ربحك الحقيقي";

function upsert(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function Seo({ title, description, path = "/", noindex = false }) {
  useEffect(() => {
    document.title = title;
    upsert("name", "description", description);
    upsert("property", "og:title", title);
    upsert("property", "og:description", description);
    upsert("property", "og:url", `${SITE}${path}`);

    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", `${SITE}${path}`);

    if (noindex) upsert("name", "robots", "noindex, nofollow");
    else {
      const robots = document.head.querySelector('meta[name="robots"]');
      if (robots) robots.remove();
    }

    return () => {
      document.title = DEFAULT_TITLE;
      const robots = document.head.querySelector('meta[name="robots"]');
      if (robots) robots.remove();
      const c = document.head.querySelector('link[rel="canonical"]');
      if (c) c.remove();
    };
  }, [title, description, path, noindex]);
  return null;
}
