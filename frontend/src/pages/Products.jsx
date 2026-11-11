import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, Pencil, Trash2, Package, Upload, Download } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fmtMoney, fmtPct, marginTone } from "../lib/calculations";
import { specLabel } from "../i18n";
import { ImportModal } from "../components/products/ImportModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";

const toneBadge = {
  danger: "bg-red-50 text-red-700 border-red-100",
  warning: "bg-amber-50 text-amber-700 border-amber-100",
  success: "bg-emerald-50 text-emerald-700 border-emerald-100",
  neutral: "bg-slate-50 text-slate-600 border-slate-200",
};

export default function Products() {
  const { t } = useLanguage();
  const { can } = useAuth();
  const fin = can("products.costs") && can("finance.profit") && can("finance.margin");
  const canCreate = can("products.create");
  const canEdit = can("products.edit");
  const canDelete = can("products.delete");
  const showActions = canEdit || canDelete;
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bulkDelete = async () => {
    setBulkBusy(true);
    try {
      const { data } = await api.post("/products/bulk-delete", { product_ids: [...selected] });
      setBulkResult(data);
      setSelected(new Set());
      load();
    } catch (err) {
      toast.error(formatApiError(err, t("somethingWrong")));
    } finally {
      setBulkBusy(false);
    }
  };
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState(fin ? "profit_desc" : "name");
  const [toDelete, setToDelete] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("import") === "1") setImportOpen(true);
  }, [searchParams]);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/products");
      setProducts(data);
    } catch {
      toast.error(t("somethingWrong"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let list = [...products];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q));
    if (filter === "profitable" && fin) list = list.filter((p) => p.net_profit > 0);
    if (filter === "low_margin" && fin) list = list.filter((p) => p.profit_margin >= 0 && p.profit_margin < 10);
    if (filter === "losing" && fin) list = list.filter((p) => p.net_profit < 0);
    const sorters = {
      profit_desc: (a, b) => (b.net_profit ?? 0) - (a.net_profit ?? 0),
      profit_asc: (a, b) => (a.net_profit ?? 0) - (b.net_profit ?? 0),
      margin_desc: (a, b) => (b.profit_margin ?? 0) - (a.profit_margin ?? 0),
      qty_desc: (a, b) => b.quantity_sold - a.quantity_sold,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    const effectiveSort = !fin && (sort === "profit_desc" || sort === "profit_asc" || sort === "margin_desc") ? "name" : sort;
    return list.sort(sorters[effectiveSort] || sorters.name);
  }, [products, search, filter, sort, fin]);

  const confirmDelete = async () => {
    try {
      await api.delete(`/products/${toDelete.product_id}`);
      toast.success(t("productDeleted"));
      setProducts((ps) => ps.filter((p) => p.product_id !== toDelete.product_id));
    } catch {
      toast.error(t("somethingWrong"));
    } finally {
      setToDelete(null);
    }
  };

  return (
    <div className="space-y-6 fade-up" data-testid="products-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t("productsTitle")}</h1>
          <p className="text-slate-500 text-sm mt-1">
            {products.length} {t("productsCount")}
          </p>
        </div>
        {canCreate && (
          <div className="flex gap-2.5">
            <a href={`${process.env.REACT_APP_BACKEND_URL}/api/products/export.xlsx`} download data-testid="export-products-btn"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700 font-semibold text-sm transition-colors bg-white">
              <Download className="w-4 h-4" /> {t("exportProducts")}
            </a>
            <button
              onClick={() => setImportOpen(true)}
              data-testid="import-products-btn"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-emerald-500/40 text-emerald-600 hover:bg-emerald-50 font-semibold text-sm transition-colors"
            >
              <Upload className="w-4 h-4" /> {t("importProducts")}
            </button>
            <Link
              to="/products/new"
              data-testid="add-product-btn"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors"
            >
              <Plus className="w-4 h-4" /> {t("navAddProduct")}
            </Link>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input
            data-testid="products-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full ps-10 pe-4 py-2.5 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
          />
        </div>
        <select
          data-testid="products-filter-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:ring-2 focus:ring-emerald-500"
        >
          <option value="all">{t("filterAll")}</option>
          <option value="profitable">{t("filterProfitable")}</option>
          <option value="low_margin">{t("filterLowMargin")}</option>
          <option value="losing">{t("filterLosing")}</option>
        </select>
        <select
          data-testid="products-sort-select"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:ring-2 focus:ring-emerald-500"
        >
          {fin && <option value="profit_desc">{t("sortProfitHigh")}</option>}
          {fin && <option value="profit_asc">{t("sortProfitLow")}</option>}
          {fin && <option value="margin_desc">{t("sortMarginHigh")}</option>}
          <option value="qty_desc">{t("sortQtyHigh")}</option>
          <option value="name">{t("sortName")}</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20" data-testid="products-loading">
          <div className="w-10 h-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center" data-testid="products-empty">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <Package className="w-7 h-7 text-emerald-500" />
          </div>
          <p className="font-semibold text-slate-800">{products.length === 0 ? t("emptyTitle") : t("noResults")}</p>
          {products.length === 0 && (
            <Link
              to="/products/new"
              data-testid="products-empty-add-btn"
              className="inline-flex items-center gap-2 mt-5 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors"
            >
              <Plus className="w-4 h-4" /> {t("addFirst")}
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto" data-testid="products-table">
          {selected.size > 0 && canDelete && (
            <div className="flex items-center justify-between gap-3 px-5 py-3 bg-emerald-50/60 border-b border-emerald-100" data-testid="bulk-actions-bar">
              <span className="text-sm font-semibold text-emerald-800 tabular">{selected.size}</span>
              <button data-testid="bulk-delete-btn" onClick={bulkDelete} disabled={bulkBusy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-60">
                <Trash2 className="w-4 h-4" /> {t("deleteSelected")} ({selected.size})
              </button>
            </div>
          )}
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                {canDelete && (
                  <th className="px-4 py-3.5 w-10">
                    <input type="checkbox" data-testid="select-all-products" className="w-4 h-4 accent-emerald-600 cursor-pointer"
                      checked={filtered.length > 0 && filtered.every((p) => selected.has(p.product_id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((p) => p.product_id)) : new Set())}
                      title={t("selectAll")} />
                  </th>
                )}
                <th className="text-start font-medium px-5 py-3.5">{t("thProduct")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("thPrice")}</th>
                {fin && <th className="text-start font-medium px-5 py-3.5">{t("thUnitCost")}</th>}
                <th className="text-start font-medium px-5 py-3.5">{t("stockCol")}</th>
                <th className="text-start font-medium px-5 py-3.5">{t("thQty")}</th>
                {fin && <th className="text-start font-medium px-5 py-3.5">{t("thNetProfit")}</th>}
                {fin && <th className="text-start font-medium px-5 py-3.5">{t("thMargin")}</th>}
                {showActions && <th className="px-5 py-3.5" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.product_id}
                  data-testid={`product-row-${p.product_id}`}
                  onClick={() => navigate(`/products/${p.product_id}`)}
                  className={`border-b border-slate-50 hover:bg-slate-50/60 cursor-pointer transition-colors ${selected.has(p.product_id) ? "bg-emerald-50/50" : ""}`}
                >
                  {canDelete && (
                    <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" data-testid={`select-product-${p.product_id}`} className="w-4 h-4 accent-emerald-600 cursor-pointer"
                        checked={selected.has(p.product_id)} onChange={() => toggleSelect(p.product_id)} />
                    </td>
                  )}
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="font-semibold text-slate-800">{p.name}</p>
                        {specLabel(p, t) && (
                          <p className="text-xs text-slate-400" data-testid={`spec-cell-${p.product_id}`}>{specLabel(p, t)}</p>
                        )}
                        {p.sku && <p className="text-xs text-slate-400 tabular">{p.sku}</p>}
                      </div>
                      {p.is_demo && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                          {t("demoBadge")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4 tabular text-slate-700">{p.selling_price != null ? fmtMoney(p.selling_price) : "—"}</td>
                  {fin && <td className="px-5 py-4 tabular text-slate-700">{fmtMoney(p.unit_cost)}</td>}
                  <td className="px-5 py-4 tabular" data-testid={`stock-cell-${p.product_id}`}>
                    <span className={`font-semibold ${p.minimum_stock_level > 0 && (p.stock_qty ?? 0) <= p.minimum_stock_level ? "text-amber-600" : "text-slate-700"}`}>
                      {p.stock_qty ?? 0}
                    </span>
                  </td>
                  <td className="px-5 py-4 tabular text-slate-700">{p.quantity_sold}</td>
                  {fin && (
                    <td className={`px-5 py-4 tabular font-semibold ${p.net_profit < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {fmtMoney(p.net_profit)}
                    </td>
                  )}
                  {fin && (
                    <td className="px-5 py-4">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border tabular ${toneBadge[marginTone(p.profit_margin)]}`}>
                        {fmtPct(p.profit_margin)}
                      </span>
                    </td>
                  )}
                  {showActions && (
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                        {canEdit && (
                          <button
                            data-testid={`edit-product-${p.product_id}`}
                            onClick={() => navigate(`/products/${p.product_id}/edit`)}
                            className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            data-testid={`delete-product-${p.product_id}`}
                            onClick={() => setToDelete(p)}
                            className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent data-testid="delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.name} — {t("deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="delete-cancel-btn">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="delete-confirm-btn"
              onClick={confirmDelete}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {t("confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={() => { load(); if (searchParams.get("onboarding") === "1") navigate("/onboarding"); }} />

      <AlertDialog open={!!bulkResult} onOpenChange={(v) => !v && setBulkResult(null)}>
        <AlertDialogContent data-testid="bulk-delete-result">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bulkDeleteDone")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{t("bulkDeleteSummary", { deleted: bulkResult?.deleted ?? 0, archived: bulkResult?.archived ?? 0 })}</p>
                {(bulkResult?.archived ?? 0) > 0 && (
                  <p className="text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs" data-testid="archived-notice">
                    {t("archivedNotice")} {bulkResult.archived_names.join("، ")}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction data-testid="bulk-delete-ok" onClick={() => setBulkResult(null)}>{t("cancel") === "cancel" ? "OK" : "حسناً"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
