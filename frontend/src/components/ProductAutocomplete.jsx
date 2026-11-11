import { useEffect, useRef, useState } from "react";
import { ChevronDown, Package } from "lucide-react";

export const inputCls = "w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors bg-white";

/**
 * Searchable product typeahead used by the Sales and Purchases forms.
 * Typing filters existing products instantly; selecting picks that product only
 * (it never creates a new product). Pass onAdd to show an "add product" action
 * when nothing matches; omit it to keep the list read-only.
 */
export function ProductAutocomplete({ products, value, onPick, onAdd, index, prefix, t, required = true, className = "" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef(null);
  const selected = products.find((p) => p.product_id === value);
  const q = query.trim().toLowerCase();
  const matches = q
    ? products.filter((p) =>
        (p.name || "").toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q))
    : products;

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, []);

  const pick = (p) => {
    onPick(p);
    setOpen(false);
    setQuery("");
  };

  const onKey = (e) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && open && matches[hi]) { e.preventDefault(); pick(matches[hi]); }
  };

  return (
    <div className={`relative ${className}`} ref={ref}>
      <div className="relative">
        <Package className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
        <input
          data-testid={`${prefix}-product-${index}`}
          type="text"
          autoComplete="off"
          value={open ? query : selected?.name || ""}
          placeholder={t("selectProduct")}
          onFocus={() => { setOpen(true); setQuery(""); setHi(0); }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHi(0);
            if (selected && e.target.value !== selected.name) onPick(null);
          }}
          onKeyDown={onKey}
          className={`${inputCls} ps-9 pe-8 min-w-0 w-full max-w-full`}
          required={required}
        />
        <ChevronDown className={`w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 end-3 pointer-events-none transition-transform ${open ? "rotate-180" : ""}`} />
      </div>
      {open && (
        <div
          data-testid={`${prefix}-dropdown-${index}`}
          className="absolute z-30 top-full mt-1 start-0 w-72 max-w-[80vw] max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white shadow-lg"
          style={{ touchAction: "pan-y" }}
        >
          {matches.length === 0 && (
            <div className="px-3 py-3 text-center" data-testid={`${prefix}-empty-${index}`}>
              <p className="text-xs text-slate-400">{t("noResults")}</p>
              {onAdd && (
                <button
                  type="button"
                  data-testid={`${prefix}-add-${index}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setOpen(false); onAdd(query.trim()); }}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors"
                >
                  {t("addProductTitle")}
                </button>
              )}
            </div>
          )}
          {matches.map((p, j) => (
            <button
              key={p.product_id}
              type="button"
              data-testid={`${prefix}-option-${index}-${p.product_id}`}
              onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setHi(j)}
              className={`w-full text-start px-3 py-2.5 text-sm transition-colors flex items-center justify-between gap-2 ${
                j === hi ? "bg-emerald-50 text-emerald-800" : "text-slate-700"
              } ${p.product_id === value ? "font-bold" : ""}`}
            >
              <span className="truncate">{p.name}{p.sku ? ` · ${p.sku}` : ""}</span>
              <span className="text-[11px] text-slate-400 tabular shrink-0">{p.stock_qty ?? ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
