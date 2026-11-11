import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from core import db, get_current_user, now_iso, effective_permissions
from subscriptions import get_status

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")

SYSTEM_PROMPT = """You are "المساعد المالي" — the AI financial assistant built into ProfitLens, a business management app.
STRICT RULES:
1. Use ONLY the DATA snapshot below (real database aggregates computed server-side). NEVER invent, estimate, or extrapolate numbers. If the answer is not in DATA, say the data is not available for that.
2. Respect "authorized_modules": if the user asks about information not present in DATA or not authorized for their role, politely say you don't have access to it.
3. Multi-currency: monetary values are grouped per currency code. There are NO exchange rates — NEVER add, convert, or compare amounts across different currencies. Always state the currency next to every amount.
4. Answer in the user's language (default Arabic). Be concise, professional, and well-organized.
5. Format with Markdown: tables for lists and comparisons, **bold** for KPIs, bullet points. Compute deltas/percentages only from numbers present in DATA.
6. Dates are ISO UTC; "today" is the today field in DATA. For period comparisons use the monthly breakdown.
7. DATA may include "requested_records": exact database records fetched because the user mentioned a specific invoice number, date, product, customer, or supplier. Answer those questions from these records only. If a requested record is absent from requested_records, it does not exist — say so clearly.
8. You are READ-ONLY: you cannot create, edit, or delete anything. If asked to modify data, explain that you can only answer questions.
9. Partner purchase shares: when DATA.partners is present, each partner already carries the exact fields needed — ownership_percentage, shared_purchases_total (non-cancelled purchases only), allocated_share, paid_contributions, remaining_owed. Answer partner share/remaining-balance questions from these fields directly, never from chat history or assumptions. If ownership_percentage is null for a partner, state that the ownership percentage is missing instead of inventing one. A negative remaining_owed means the partner overpaid (has credit).
"""

NUM_RE = re.compile(r"\b([SPR])-0*(\d{1,6})\b", re.IGNORECASE)
DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")


class ChatInput(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: str = Field(min_length=8, max_length=64)


def _cur(s, base):
    return s.get("currency") or base


def _sale_row(s, base, fin):
    row = {
        "sale_number": s.get("sale_number"),
        "date": (s.get("date") or "")[:10],
        "customer": s.get("customer") or "",
        "payment_method": s.get("payment_method"),
        "currency": _cur(s, base),
        "items": [
            {
                "product": it.get("name"),
                "quantity": it.get("quantity"),
                "unit_type": it.get("unit_type"),
                "unit_price": it.get("unit_price"),
                "discount": it.get("discount"),
                "total": it.get("total"),
            }
            for it in s.get("items", [])
        ],
        "subtotal": s.get("subtotal"),
        "discount_total": s.get("discount_total"),
        "total": s.get("total"),
    }
    if fin:
        row["cogs"] = s.get("cogs")
        row["profit"] = s.get("profit")
    return row


def _purchase_row(p):
    return {
        "purchase_number": p.get("purchase_number"),
        "supplier_invoice_number": p.get("invoice_number") or "",
        "date": (p.get("purchase_date") or "")[:10],
        "supplier": p.get("supplier"),
        "items": [
            {"product": it.get("name"), "quantity": it.get("quantity"), "unit_cost": it.get("unit_cost"), "total": it.get("total")}
            for it in p.get("items", [])
        ],
        "subtotal": p.get("subtotal"),
        "additional_costs": p.get("additional_costs"),
        "total": p.get("total"),
    }


def _expense_row(e):
    return {
        "date": (e.get("date") or "")[:10],
        "category": e.get("category"),
        "amount": e.get("amount"),
        "description": e.get("description") or "",
        "notes": e.get("notes") or "",
    }


def _return_row(r, base):
    return {
        "return_number": r.get("return_number"),
        "sale_number": r.get("sale_number"),
        "date": (r.get("return_date") or r.get("date") or "")[:10],
        "reason": r.get("reason") or "",
        "refund_method": r.get("refund_method"),
        "currency": _cur(r, base),
        "items": [
            {"product": it.get("name"), "quantity": it.get("quantity"), "total": it.get("total")}
            for it in r.get("items", [])
        ],
        "refund_total": r.get("refund_total"),
    }


def _blank_bucket(fin, margin):
    b = {"revenue": 0.0, "count": 0}
    if fin:
        b["cogs"] = 0.0
        b["profit"] = 0.0
    if margin:
        b["margin_pct"] = None
    return b


def _close_bucket(b, fin, margin):
    b["revenue"] = round(b["revenue"], 2)
    if fin:
        b["cogs"] = round(b["cogs"], 2)
        b["profit"] = round(b["profit"], 2)
    if margin:
        b["margin_pct"] = round(b["profit"] / b["revenue"] * 100, 1) if b["revenue"] else None
    return b


async def _sales_section(bid: str, base: str, fin: bool, margin: bool, today: str, d7: str, d30: str) -> dict:
    sales = await db.sales.find(
        {"business_id": bid, "status": "confirmed"},
        {"_id": 0, "business_id": 0, "user_id": 0},
    ).sort("date", -1).to_list(10000)
    sales_out = {}
    for label, frm in (("today", today), ("last_7_days", d7), ("last_30_days", d30)):
        buckets = {}
        for s in sales:
            if (s.get("date") or "")[:10] < frm:
                continue
            b = buckets.setdefault(_cur(s, base), _blank_bucket(fin, margin))
            b["revenue"] += s.get("total", 0) or 0
            b["count"] += 1
            if fin:
                b["cogs"] += s.get("cogs", 0) or 0
                b["profit"] += s.get("profit", 0) or 0
        sales_out[label] = {c: _close_bucket(b, fin, margin) for c, b in buckets.items()}
    sales_out["monthly"] = _sales_monthly(sales, base, fin, margin)
    sales_out["top_products_last_30_days"] = _top_products(sales, base, d30)
    sales_out["customers"] = _top_customers(sales, base)
    sales_out["recent_sales"] = [_sale_row(s, base, fin) for s in sales[:30]]
    return sales_out


def _sales_monthly(sales: list, base: str, fin: bool, margin: bool) -> dict:
    monthly = {}
    for s in sales:
        mk = (s.get("date") or "")[:7]
        if not mk:
            continue
        mb = monthly.setdefault(mk, {})
        b = mb.setdefault(_cur(s, base), _blank_bucket(fin, margin))
        b["revenue"] += s.get("total", 0) or 0
        b["count"] += 1
        if fin:
            b["cogs"] += s.get("cogs", 0) or 0
            b["profit"] += s.get("profit", 0) or 0
    return {
        mk: {c: _close_bucket(b, fin, margin) for c, b in curbs.items()}
        for mk, curbs in sorted(monthly.items(), reverse=True)[:6]
    }


def _top_products(sales: list, base: str, d30: str) -> list:
    top = {}
    for s in sales:
        if (s.get("date") or "")[:10] < d30:
            continue
        for it in s.get("items", []):
            t = top.setdefault((it.get("name") or "?", _cur(s, base)), {"quantity": 0, "revenue": 0.0})
            t["quantity"] += it.get("quantity", 0) or 0
            t["revenue"] += it.get("total", 0) or 0
    return [
        {"product": k[0], "currency": k[1], "quantity": v["quantity"], "revenue": round(v["revenue"], 2)}
        for k, v in sorted(top.items(), key=lambda kv: -kv[1]["revenue"])[:10]
    ]


def _top_customers(sales: list, base: str) -> list:
    customers = {}
    for s in sales:
        name = (s.get("customer") or "").strip()
        if not name:
            continue
        cb = customers.setdefault((name, _cur(s, base)), {"sales_count": 0, "total": 0.0})
        cb["sales_count"] += 1
        cb["total"] += s.get("total", 0) or 0
    return [
        {"name": k[0], "currency": k[1], "sales_count": v["sales_count"], "total": round(v["total"], 2)}
        for k, v in sorted(customers.items(), key=lambda kv: -kv[1]["total"])[:25]
    ]


async def _purchases_section(bid: str, base: str, d30: str) -> dict:
    purchases = await db.purchases.find({"business_id": bid}, {"_id": 0, "business_id": 0}).sort("purchase_date", -1).to_list(10000)
    pb = {}
    suppliers = {}
    for p in purchases:
        if (p.get("purchase_date") or "")[:10] >= d30:
            b = pb.setdefault(base, {"total": 0.0, "count": 0})
            b["total"] += p.get("total", 0) or 0
            b["count"] += 1
        name = (p.get("supplier") or "").strip()
        if name:
            sb = suppliers.setdefault(name, {"purchases_count": 0, "total": 0.0})
            sb["purchases_count"] += 1
            sb["total"] += p.get("total", 0) or 0
    return {
        "purchases_last_30_days": {c: {"total": round(b["total"], 2), "count": b["count"]} for c, b in pb.items()},
        "suppliers": {
            "currency": base,
            "items": [
                {"name": k, "purchases_count": v["purchases_count"], "total": round(v["total"], 2)}
                for k, v in sorted(suppliers.items(), key=lambda kv: -kv[1]["total"])[:25]
            ],
        },
        "recent_purchases": {"currency": base, "items": [_purchase_row(p) for p in purchases[:30]]},
    }


async def _expenses_section(bid: str, base: str, d30: str) -> dict:
    expenses = await db.expenses.find({"business_id": bid}, {"_id": 0, "business_id": 0}).sort("date", -1).to_list(10000)
    eb = {}
    for e in expenses:
        if (e.get("date") or "")[:10] < d30:
            continue
        cat = e.get("category") or "other"
        eb[cat] = eb.get(cat, 0.0) + (e.get("amount", 0) or 0)
    return {
        "expenses_last_30_days": {
            "currency": base,
            "by_category": {k: round(v, 2) for k, v in sorted(eb.items(), key=lambda kv: -kv[1])},
            "total": round(sum(eb.values()), 2),
        },
        "recent_expenses": {"currency": base, "items": [_expense_row(e) for e in expenses[:30]]},
    }


async def _returns_section(bid: str, base: str, d30: str) -> dict:
    returns = await db.returns.find({"business_id": bid}, {"_id": 0, "business_id": 0}).sort("created_at", -1).to_list(10000)
    rb = {}
    for r in returns:
        if (r.get("return_date") or r.get("date") or "")[:10] < d30:
            continue
        b = rb.setdefault(_cur(r, base), {"refund_total": 0.0, "count": 0})
        b["refund_total"] += r.get("refund_total", 0) or 0
        b["count"] += 1
    return {
        "returns_last_30_days": {c: {"refund_total": round(b["refund_total"], 2), "count": b["count"]} for c, b in rb.items()},
        "recent_returns": [_return_row(r, base) for r in returns[:30]],
    }


async def _products_section(bid: str, base: str, perms: dict, margin: bool) -> dict:
    prods = await db.products.find(
        {"business_id": bid},
        {"_id": 0, "name": 1, "stock_qty": 1, "minimum_stock_level": 1, "selling_price": 1, "product_cost": 1, "quantity_sold": 1},
    ).to_list(2000)
    rows = []
    low = []
    for p in prods:
        row = {
            "name": p.get("name"),
            "stock": p.get("stock_qty", 0) or 0,
            "min_stock": p.get("minimum_stock_level", 0) or 0,
            "selling_price": p.get("selling_price", 0) or 0,
            "quantity_sold": p.get("quantity_sold", 0) or 0,
        }
        if perms.get("products.costs"):
            cost = p.get("product_cost", 0) or 0
            row["unit_cost"] = cost
            if margin and row["selling_price"]:
                row["margin_pct"] = round((row["selling_price"] - cost) / row["selling_price"] * 100, 1)
        rows.append(row)
        if row["min_stock"] and row["stock"] <= row["min_stock"]:
            low.append({"name": row["name"], "stock": row["stock"], "min_stock": row["min_stock"]})
    rows.sort(key=lambda r: -(r["quantity_sold"]))
    return {
        "products": {"currency": base, "count": len(rows), "items": rows[:15]},
        "low_stock_alerts": low[:15],
    }


async def _partners_section(bid: str, base: str) -> dict:
    partners = await db.partners.find({"business_id": bid}, {"_id": 0, "business_id": 0}).to_list(50)
    if not partners:
        return {"partners": {"currency": base, "items": []}}

    # Eligible shared purchases: all non-cancelled purchases (cancelled are excluded, no double-counting)
    agg = await db.purchases.aggregate([
        {"$match": {"business_id": bid, "status": {"$ne": "cancelled"}}},
        {"$group": {"_id": None, "total": {"$sum": "$total"}, "count": {"$sum": 1}}},
    ]).to_list(1)
    shared_total = round(agg[0]["total"], 2) if agg else 0.0
    shared_count = agg[0]["count"] if agg else 0

    pids = [p["partner_id"] for p in partners]
    txns = await db.partner_transactions.find({"partner_id": {"$in": pids}}, {"_id": 0}).to_list(10000)
    sums = {}
    for t in txns:
        b = sums.setdefault(t["partner_id"], {"allocation": 0.0, "contribution": 0.0, "withdrawal": 0.0})
        if t.get("type") in b:
            b[t["type"]] += t.get("amount", 0) or 0

    items = []
    for p in partners[:20]:
        pct = p.get("ownership_percentage")
        s = sums.get(p["partner_id"], {})
        paid = round(s.get("contribution", 0.0), 2)
        balance = round(s.get("allocation", 0.0) + s.get("contribution", 0.0) - s.get("withdrawal", 0.0), 2)
        valid_pct = isinstance(pct, (int, float)) and not isinstance(pct, bool)
        allocated = round(shared_total * pct / 100, 2) if valid_pct else None
        row = {
            "name": p.get("name"),
            "status": p.get("status"),
            "ownership_percentage": pct if valid_pct else None,
            "shared_purchases_total": shared_total,
            "shared_purchases_count": shared_count,
            "allocated_share": allocated,
            "paid_contributions": paid,
            "remaining_owed": round(allocated - paid, 2) if allocated is not None else None,
            "balance": balance,
        }
        if not valid_pct:
            row["missing_data"] = "ownership_percentage is not set for this partner"
        items.append(row)

    return {
        "partners": {
            "currency": base,
            "method_note": "allocated_share = ownership_percentage/100 * shared_purchases_total (only non-cancelled purchases). remaining_owed = allocated_share - paid_contributions; negative remaining_owed means the partner overpaid (credit).",
            "items": items,
        }
    }


async def _salaries_section(bid: str, base: str) -> dict:
    team = await db.users.find(
        {"business_id": bid, "status": "active"}, {"_id": 0, "name": 1, "role": 1, "salary": 1}
    ).to_list(100)
    return {
        "team_salaries": {
            "currency": base,
            "items": [
                {"name": u.get("name"), "role": u.get("role"), "salary": u.get("salary", 0) or 0}
                for u in team[:20]
            ],
        }
    }


async def build_context(user: dict) -> dict:
    bid = user["business_id"]
    perms = effective_permissions(user)
    biz = await db.businesses.find_one({"business_id": bid}, {"_id": 0, "name": 1, "base_currency": 1})
    base = (biz or {}).get("base_currency", "USD")
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    d7 = (now - timedelta(days=7)).date().isoformat()
    d30 = (now - timedelta(days=30)).date().isoformat()

    ctx = {
        "business_name": (biz or {}).get("name", ""),
        "base_currency": base,
        "today": today,
        "authorized_modules": sorted(k for k, v in perms.items() if v),
        "currency_note": "Amounts are grouped by currency code. Never sum or convert across currencies; no exchange rates exist.",
    }

    fin = bool(perms.get("products.costs") and perms.get("finance.profit"))
    margin = fin and bool(perms.get("finance.margin"))

    if perms.get("sales.view"):
        ctx["sales"] = await _sales_section(bid, base, fin, margin, today, d7, d30)
    if perms.get("purchases.view"):
        ctx.update(await _purchases_section(bid, base, d30))
    if perms.get("expenses.view"):
        ctx.update(await _expenses_section(bid, base, d30))
    if perms.get("returns.view"):
        ctx.update(await _returns_section(bid, base, d30))
    if perms.get("products.view") or perms.get("inventory.view"):
        ctx.update(await _products_section(bid, base, perms, margin))
    if perms.get("partners.view"):
        ctx.update(await _partners_section(bid, base))
    if perms.get("salaries.view"):
        ctx.update(await _salaries_section(bid, base))

    return ctx


async def _fetch_by_numbers(bid: str, msg: str, base: str, perms: dict, fin: bool) -> dict:
    out = {}
    for m in NUM_RE.finditer(msg):
        prefix = m.group(1).upper()
        num = f"{prefix}-{int(m.group(2)):04d}"
        doc = None
        if prefix == "S" and perms.get("sales.view"):
            doc = await db.sales.find_one({"business_id": bid, "sale_number": num}, {"_id": 0, "business_id": 0, "user_id": 0})
            if doc:
                out.setdefault("sales_by_number", []).append(_sale_row(doc, base, fin))
        elif prefix == "P" and perms.get("purchases.view"):
            doc = await db.purchases.find_one({"business_id": bid, "purchase_number": num}, {"_id": 0, "business_id": 0})
            if doc:
                out.setdefault("purchases_by_number", []).append(_purchase_row(doc))
        elif prefix == "R" and perms.get("returns.view"):
            doc = await db.returns.find_one({"business_id": bid, "return_number": num}, {"_id": 0, "business_id": 0})
            if doc:
                out.setdefault("returns_by_number", []).append(_return_row(doc, base))
    return out


async def _fetch_by_supplier_invoice(bid: str, msg: str, perms: dict) -> dict:
    inv_tokens = [t for t in re.findall(r"\b[\w-]{3,}\b", msg) if any(ch.isdigit() for ch in t)]
    if not inv_tokens or not perms.get("purchases.view"):
        return {}
    docs = await db.purchases.find(
        {"business_id": bid, "invoice_number": {"$in": inv_tokens[:10]}}, {"_id": 0, "business_id": 0}
    ).to_list(10)
    if not docs:
        return {}
    return {"purchases_by_supplier_invoice": [_purchase_row(d) for d in docs]}


async def _fetch_by_dates(bid: str, msg: str, base: str, perms: dict, fin: bool) -> dict:
    out = {}
    for d in sorted(set(DATE_RE.findall(msg)))[:3]:
        day = {}
        if perms.get("sales.view"):
            docs = await db.sales.find(
                {"business_id": bid, "status": "confirmed", "date": {"$regex": "^" + re.escape(d)}},
                {"_id": 0, "business_id": 0, "user_id": 0},
            ).to_list(50)
            day["sales"] = [_sale_row(s, base, fin) for s in docs]
        if perms.get("purchases.view"):
            docs = await db.purchases.find(
                {"business_id": bid, "purchase_date": {"$regex": "^" + re.escape(d)}}, {"_id": 0, "business_id": 0}
            ).to_list(50)
            day["purchases"] = [_purchase_row(p) for p in docs]
        if perms.get("expenses.view"):
            docs = await db.expenses.find({"business_id": bid, "date": d}, {"_id": 0, "business_id": 0}).to_list(50)
            day["expenses"] = [_expense_row(e) for e in docs]
        if perms.get("returns.view"):
            docs = await db.returns.find(
                {"business_id": bid, "return_date": {"$regex": "^" + re.escape(d)}}, {"_id": 0, "business_id": 0}
            ).to_list(50)
            day["returns"] = [_return_row(r, base) for r in docs]
        out[d] = day
    return {"records_by_date": out} if out else {}


async def _product_record(bid: str, pid: str, name: str, base: str, perms: dict, fin: bool) -> dict:
    entry = {"product": name}
    if perms.get("products.view") or perms.get("inventory.view"):
        card = await db.products.find_one(
            {"product_id": pid}, {"_id": 0, "business_id": 0, "user_id": 0}
        )
        if card:
            entry["details"] = {
                k: card.get(k)
                for k in ("name", "stock_qty", "minimum_stock_level", "selling_price", "quantity_sold", "created_at")
                if card.get(k) is not None
            }
            if perms.get("products.costs"):
                entry["details"]["product_cost"] = card.get("product_cost")
    if perms.get("sales.view"):
        docs = await db.sales.find(
            {"business_id": bid, "status": "confirmed", "items.product_id": pid},
            {"_id": 0, "business_id": 0, "user_id": 0},
        ).sort("date", -1).to_list(10)
        entry["recent_sales_with_product"] = [_sale_row(s, base, fin) for s in docs]
    return entry


async def _fetch_product_records(bid: str, low: str, base: str, perms: dict, fin: bool) -> dict:
    prods = await db.products.find({"business_id": bid}, {"_id": 0, "product_id": 1, "name": 1}).to_list(2000)
    records = []
    for p in prods:
        nm = (p.get("name") or "").strip()
        if len(nm) < 3 or nm.lower() not in low:
            continue
        records.append(await _product_record(bid, p["product_id"], nm, base, perms, fin))
        if len(records) >= 5:
            break
    return {"product_records": records} if records else {}


async def _fetch_named_records(bid: str, low: str, base: str, perms: dict, fin: bool, kind: str) -> dict:
    is_customer = kind == "customer"
    if not perms.get("sales.view" if is_customer else "purchases.view"):
        return {}
    coll = db.sales if is_customer else db.purchases
    query = {"business_id": bid, "status": "confirmed"} if is_customer else {"business_id": bid}
    projection = {"_id": 0, "business_id": 0, "user_id": 0} if is_customer else {"_id": 0, "business_id": 0}
    sort_field = "date" if is_customer else "purchase_date"
    row_fn = (lambda d: _sale_row(d, base, fin)) if is_customer else _purchase_row
    out_key = "customer_records" if is_customer else "supplier_records"
    name_key = "customer" if is_customer else "supplier"
    list_key = "sales" if is_customer else "purchases"
    records = []
    for nm in await coll.distinct(kind, query):
        nm = (nm or "").strip()
        if len(nm) < 3 or nm.lower() not in low:
            continue
        docs = await coll.find({**query, kind: nm}, projection).sort(sort_field, -1).to_list(15)
        entry = {name_key: nm, list_key: [row_fn(d) for d in docs]}
        if not is_customer:
            entry["currency"] = base
        records.append(entry)
        if len(records) >= 5:
            break
    return {out_key: records} if records else {}


async def fetch_requested(message: str, user: dict, base: str, perms: dict, fin: bool) -> dict:
    bid = user["business_id"]
    msg = message or ""
    low = msg.lower()
    out = {}
    out.update(await _fetch_by_numbers(bid, msg, base, perms, fin))
    out.update(await _fetch_by_supplier_invoice(bid, msg, perms))
    out.update(await _fetch_by_dates(bid, msg, base, perms, fin))
    out.update(await _fetch_product_records(bid, low, base, perms, fin))
    out.update(await _fetch_named_records(bid, low, base, perms, fin, "customer"))
    out.update(await _fetch_named_records(bid, low, base, perms, fin, "supplier"))
    return out


@router.get("/history")
async def history(session_id: str, user: dict = Depends(get_current_user)):
    sub = await get_status(user["business_id"])
    if not sub["assistant_access"]:
        raise HTTPException(status_code=403, detail="ASSISTANT_SUBSCRIPTION_EXPIRED")
    msgs = await db.assistant_messages.find(
        {"user_id": user["user_id"], "session_id": session_id}, {"_id": 0, "role": 1, "content": 1, "created_at": 1}
    ).sort("created_at", 1).to_list(50)
    return {"messages": msgs}


@router.post("/chat")
async def chat(data: ChatInput, user: dict = Depends(get_current_user)):
    if not LLM_KEY:
        return StreamingResponse(_err_gen(), media_type="text/event-stream")
    sub = await get_status(user["business_id"])
    if not sub["assistant_access"]:
        raise HTTPException(status_code=403, detail="ASSISTANT_SUBSCRIPTION_EXPIRED")
    ctx = await build_context(user)
    perms = effective_permissions(user)
    fin = bool(perms.get("products.costs") and perms.get("finance.profit"))
    requested = await fetch_requested(data.message, user, ctx.get("base_currency", "USD"), perms, fin)
    if requested:
        ctx["requested_records"] = requested
    sid = data.session_id
    hist = await db.assistant_messages.find(
        {"user_id": user["user_id"], "session_id": sid}, {"_id": 0, "role": 1, "content": 1}
    ).sort("created_at", 1).to_list(20)
    transcript = "\n".join(("User" if m["role"] == "user" else "Assistant") + ": " + m["content"] for m in hist[-8:])
    system = SYSTEM_PROMPT + "\nDATA (real database snapshot, computed at " + now_iso() + "):\n" + json.dumps(ctx, ensure_ascii=False, default=str)
    prompt = (("CONVERSATION SO FAR:\n" + transcript + "\n\n") if transcript else "") + "CURRENT QUESTION: " + data.message

    await db.assistant_messages.insert_one({
        "message_id": f"msg_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "business_id": user["business_id"],
        "session_id": sid,
        "role": "user",
        "content": data.message,
        "created_at": now_iso(),
    })

    async def gen():
        from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

        parts = []
        try:
            llm = LlmChat(api_key=LLM_KEY, session_id=f"pl-assistant-{sid}", system_message=system).with_model("openai", "gpt-5.4")
            async for ev in llm.stream_message(UserMessage(text=prompt)):
                if isinstance(ev, TextDelta):
                    parts.append(ev.content)
                    yield "data: " + json.dumps({"delta": ev.content}, ensure_ascii=False) + "\n\n"
                elif isinstance(ev, StreamDone):
                    break
        except Exception:
            yield "data: " + json.dumps({"error": True}, ensure_ascii=False) + "\n\n"
            return
        reply = "".join(parts)
        await db.assistant_messages.insert_one({
            "message_id": f"msg_{uuid.uuid4().hex[:12]}",
            "user_id": user["user_id"],
            "business_id": user["business_id"],
            "session_id": sid,
            "role": "assistant",
            "content": reply,
            "created_at": now_iso(),
        })
        yield "data: " + json.dumps({"done": True}, ensure_ascii=False) + "\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def _err_gen():
    yield "data: " + json.dumps({"error": True}, ensure_ascii=False) + "\n\n"
