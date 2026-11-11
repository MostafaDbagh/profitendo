from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query, Request

from core import db, require_perm, caps_of, compute_cash_balance, pin_ok
from subscriptions import get_status

router = APIRouter(prefix="/api/reports", tags=["reports"])

REPORT_PERMS = {
    "sales": ("sales.view",),
    "purchases": ("purchases.view",),
    "inventory": ("inventory.view",),
    "returns": ("returns.view",),
    "expenses": ("expenses.view",),
    "profit": ("finance.reports",),
    "cash": ("cash.view",),
}


def in_range(iso: str, frm: Optional[str], to: Optional[str]) -> bool:
    d = (iso or "")[:10]
    if frm and d < frm:
        return False
    if to and d > to:
        return False
    return True


@router.get("/{report_type}")
async def get_report(
    report_type: str,
    request: Request,
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    user: dict = Depends(require_perm("sales.view", "purchases.view", "inventory.view", "returns.view", "expenses.view", "cash.view", "finance.reports")),
):
    if report_type not in REPORT_PERMS:
        raise HTTPException(status_code=404, detail="Unknown report")
    perms = user.get("permissions") or {}
    if not any(perms.get(k) for k in REPORT_PERMS[report_type]):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if report_type == "profit":
        sub = await get_status(user["business_id"])
        if not sub["assistant_access"]:
            raise HTTPException(status_code=403, detail="SUBSCRIPTION_REQUIRED")
    if report_type in ("profit", "cash") and not await pin_ok(request, user):
        raise HTTPException(status_code=403, detail="PIN_REQUIRED")
    bid = user["business_id"]
    caps = caps_of(user)
    fin = caps["costs"] and caps["profit"]

    if report_type == "sales":
        docs = await db.sales.find({"business_id": bid}, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(5000)
        rows = [s for s in docs if s.get("status") == "confirmed" and in_range(s.get("date"), date_from, date_to)]
        if not fin:
            for s in rows:
                s.pop("cogs", None)
                s.pop("profit", None)
                for it in s.get("items", []):
                    it.pop("unit_cost", None)
                    it.pop("cogs", None)
        result = {
            "rows": rows,
            "count": len(rows),
            "revenue": round(sum(s["total"] for s in rows), 2),
        }
        if fin:
            result["cogs"] = round(sum(s.get("cogs", 0) for s in rows), 2)
            result["profit"] = round(sum(s.get("profit", 0) for s in rows), 2)
        return result

    if report_type == "purchases":
        docs = await db.purchases.find({"business_id": bid}, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(5000)
        rows = [p for p in docs if in_range(p.get("purchase_date"), date_from, date_to)]
        return {"rows": rows, "count": len(rows), "total": round(sum(p["total"] for p in rows), 2)}

    if report_type == "inventory":
        docs = await db.products.find({"business_id": bid}, {"_id": 0}).to_list(2000)
        rows = []
        for p in docs:
            stock = p.get("stock_qty", 0) or 0
            min_stock = p.get("minimum_stock_level", 0) or 0
            row = {
                "product_id": p["product_id"],
                "name": p["name"],
                "sku": p.get("sku", ""),
                "stock_qty": stock,
                "minimum_stock_level": min_stock,
                "status": "out" if stock <= 0 else ("low" if min_stock > 0 and stock <= min_stock else "ok"),
            }
            if caps["costs"]:
                row["unit_cost"] = p.get("product_cost", 0) or 0
                row["stock_value"] = round(stock * (p.get("product_cost", 0) or 0), 2)
            rows.append(row)
        result = {"rows": rows, "count": len(rows), "low_count": sum(1 for r in rows if r["status"] in ("low", "out"))}
        if caps["costs"]:
            result["inventory_value"] = round(sum(r.get("stock_value", 0) for r in rows), 2)
        return result

    if report_type == "returns":
        docs = await db.returns.find({"business_id": bid}, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(5000)
        rows = [r for r in docs if in_range(r.get("return_date"), date_from, date_to)]
        if not fin:
            for r in rows:
                r.pop("cogs_reversed", None)
                for it in r.get("items", []):
                    it.pop("unit_cost", None)
        return {"rows": rows, "count": len(rows), "refund_total": round(sum(r["refund_total"] for r in rows), 2)}

    if report_type == "expenses":
        docs = await db.expenses.find({"business_id": bid}, {"_id": 0, "business_id": 0}).sort("date", -1).to_list(5000)
        rows = [e for e in docs if in_range(e.get("date"), date_from, date_to)]
        by_category = {}
        for e in rows:
            by_category[e["category"]] = round(by_category.get(e["category"], 0) + e["amount"], 2)
        return {"rows": rows, "count": len(rows), "total": round(sum(e["amount"] for e in rows), 2), "by_category": by_category}

    if report_type == "profit":
        sales = await db.sales.find({"business_id": bid, "status": "confirmed"}, {"_id": 0}).to_list(10000)
        sales = [s for s in sales if in_range(s.get("date"), date_from, date_to)]
        returns = await db.returns.find({"business_id": bid}, {"_id": 0}).to_list(10000)
        returns = [r for r in returns if in_range(r.get("return_date"), date_from, date_to)]
        expenses = await db.expenses.find({"business_id": bid}, {"_id": 0}).to_list(10000)
        expenses = [e for e in expenses if in_range(e.get("date"), date_from, date_to)]
        revenue = sum(s["total"] for s in sales)
        cogs = sum(s.get("cogs", 0) for s in sales)
        refunds = sum(r["refund_total"] for r in returns)
        cogs_reversed = sum(r.get("cogs_reversed", 0) for r in returns)
        net_revenue = revenue - refunds
        net_cogs = cogs - cogs_reversed
        gross = net_revenue - net_cogs
        op_expenses = sum(e["amount"] for e in expenses)
        net = gross - op_expenses
        return {
            "revenue": round(revenue, 2),
            "refunds": round(refunds, 2),
            "net_revenue": round(net_revenue, 2),
            "cogs": round(net_cogs, 2),
            "gross_profit": round(gross, 2),
            "gross_margin": round((gross / net_revenue * 100) if net_revenue > 0 else 0, 2),
            "operating_expenses": round(op_expenses, 2),
            "net_profit": round(net, 2),
            "net_margin": round((net / net_revenue * 100) if net_revenue > 0 else 0, 2),
        }

    # cash
    balance = await compute_cash_balance(bid)
    closings = await db.cash_closings.find({"business_id": bid}, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(500)
    rows = [c for c in closings if in_range(c.get("date"), date_from, date_to)]
    return {"balance": balance, "rows": rows, "count": len(rows)}
