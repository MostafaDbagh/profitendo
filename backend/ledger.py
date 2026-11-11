"""General Ledger integration: automatic double-entry journal posting from
operational transactions (sales, purchases, expenses, returns) plus GL-derived
financial statements (journal, trial balance, income statement, balance sheet).

Design:
- Entries are immutable. Edits post a reversal + a new entry; cancel/delete post a reversal.
- Idempotency: at most ONE active (posted, not reversed) entry per source document,
  enforced by a partial unique index (see server.py) plus check-before-post.
- Balances are always aggregated from posted lines — no cached balances to drift.
"""
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from accounts import seed_accounts
from core import db, require_perm, log_audit, now_iso, next_number

router = APIRouter(prefix="/api/ledger", tags=["ledger"])
logger = logging.getLogger(__name__)

SYSTEM_USER = {"user_id": "system", "name": "System"}

# expense categories that map onto seeded system subgroup accounts
EXPENSE_CATEGORY_SUBGROUP = {"rent": "rent", "salaries": "salaries", "advertising": "marketing", "transportation": "transportation"}
# remaining categories get dedicated system accounts under the Expenses root
EXPENSE_CATEGORY_FIXED_CODE = {"utilities": "6810", "shipping": "6820", "packaging": "6830", "maintenance": "6840", "taxes": "6850", "other": "6890"}
EXPENSE_CATEGORY_NAME = {"utilities": "Utilities", "shipping": "Shipping", "packaging": "Packaging", "maintenance": "Maintenance", "taxes": "Taxes", "other": "Other Expenses"}


# ---------------------------------------------------------------- account helpers

async def _accounts_map(bid: str) -> dict:
    """subgroup -> account doc (system accounts win over custom ones)."""
    await seed_accounts(bid)
    docs = await db.accounts.find({"business_id": bid}).sort("created_at", 1).to_list(1000)
    m = {}
    for d in sorted(docs, key=lambda x: (not x.get("is_system", False))):
        sg = d.get("subgroup")
        if sg and sg not in m:
            m[sg] = d
    return m


async def _expense_account(bid: str, category: str) -> dict:
    sub = EXPENSE_CATEGORY_SUBGROUP.get(category)
    if sub:
        acct = await db.accounts.find_one({"business_id": bid, "group": "expenses", "subgroup": sub})
        if acct:
            return acct
    acct = await db.accounts.find_one({"business_id": bid, "meta.expense_category": category})
    if acct:
        return acct
    root = await db.accounts.find_one({"business_id": bid, "group": "expenses", "parent_id": None})
    base = int(EXPENSE_CATEGORY_FIXED_CODE.get(category, "6890"))
    code = str(base)
    i = 0
    while await db.accounts.find_one({"business_id": bid, "code": code}):
        i += 1
        code = str(base + i)
    now = now_iso()
    doc = {
        "account_id": f"acct_{uuid.uuid4().hex[:12]}",
        "business_id": bid,
        "code": code,
        "name": EXPENSE_CATEGORY_NAME.get(category, category.replace("_", " ").title()),
        "group": "expenses",
        "subgroup": None,
        "parent_id": root["account_id"] if root else None,
        "normal_balance": "debit",
        "is_active": True,
        "is_system": True,
        "meta": {"expense_category": category},
        "created_at": now,
        "updated_at": now,
    }
    await db.accounts.insert_one(doc)
    return doc


def _line(acct: dict, debit: float = 0.0, credit: float = 0.0) -> dict:
    return {"account_id": acct["account_id"], "code": acct["code"], "name": acct["name"],
            "debit": round(debit, 2), "credit": round(credit, 2)}


def _settlement_account(m: dict, method: str, *, credit_sale_purchase: bool):
    """Debit side for sales receipts / credit side for purchases & expenses."""
    if method == "cash":
        return m["cash"]
    if method == "credit":
        return m["accounts_payable"] if credit_sale_purchase else m["accounts_receivable"]
    return m["bank"]


# ---------------------------------------------------------------- posting engine

async def _active_entry(bid: str, source_type: str, source_id: str) -> Optional[dict]:
    return await db.journal_entries.find_one({
        "business_id": bid, "source_type": source_type, "source_id": source_id,
        "kind": "posted", "is_reversed": False,
    })


async def post_source(bid, user, *, source_type, source_id, source_number, lines, narration,
                      date=None, kind="posted", reversal_of=None, backfilled=False, replace=False):
    if kind == "posted":
        existing = await _active_entry(bid, source_type, source_id)
        if existing:
            if not replace:
                return existing  # idempotent: never double-post a source document
            await reverse_source(bid, source_type, source_id, user, f"قيد عكسي للتعديل · {narration}")
    total_debit = round(sum(l["debit"] for l in lines), 2)
    total_credit = round(sum(l["credit"] for l in lines), 2)
    if total_debit <= 0 or total_debit != total_credit:
        raise HTTPException(status_code=400, detail=f"Unbalanced journal entry: {total_debit} != {total_credit}")
    now = now_iso()
    doc = {
        "entry_id": f"jrn_{uuid.uuid4().hex[:12]}",
        "business_id": bid,
        "entry_number": await next_number(bid, "journal"),
        "date": date or now,
        "source_type": source_type,
        "source_id": source_id,
        "source_number": source_number,
        "narration": narration,
        "lines": lines,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "kind": kind,
        "reversal_of": reversal_of,
        "is_reversed": False,
        "backfilled": backfilled,
        "created_by": user.get("user_id"),
        "created_by_name": user.get("name", ""),
        "created_at": now,
    }
    try:
        await db.journal_entries.insert_one(doc)
    except DuplicateKeyError:
        existing = await _active_entry(bid, source_type, source_id)
        if existing:
            return existing
        raise
    doc.pop("_id", None)
    return doc


async def reverse_source(bid, source_type, source_id, user, narration):
    existing = await _active_entry(bid, source_type, source_id)
    if not existing:
        return None  # idempotent: nothing active to reverse
    swapped = [{"account_id": l["account_id"], "code": l["code"], "name": l["name"],
                "debit": l["credit"], "credit": l["debit"]} for l in existing["lines"]]
    rev = await post_source(
        bid, user, source_type=source_type, source_id=source_id,
        source_number=existing["source_number"], lines=swapped, narration=narration,
        kind="reversal", reversal_of=existing["entry_id"], backfilled=existing.get("backfilled", False),
    )
    await db.journal_entries.update_one(
        {"entry_id": existing["entry_id"]},
        {"$set": {"is_reversed": True, "reversed_by": rev["entry_id"]}},
    )
    return rev


async def try_post(coro):
    """Operational writes must never fail because of GL posting; gaps are healed by ensure_backfilled."""
    try:
        return await coro
    except Exception:
        logger.exception("journal posting failed")
        return None


# ---------------------------------------------------------------- per-document posters

async def post_sale(bid, user, sale: dict, *, replace=False, backfilled=False):
    m = await _accounts_map(bid)
    pm = sale.get("payment_method", "cash")
    dr_acct = m["cash"] if pm == "cash" else m["accounts_receivable"] if pm == "credit" else m["bank"]
    total = round(sale.get("total", 0) or 0, 2)
    cogs = round(sale.get("cogs", 0) or 0, 2)
    lines = [_line(dr_acct, debit=total), _line(m["product_sales"], credit=total)]
    if cogs > 0:
        lines += [_line(m["cogs"], debit=cogs), _line(m["inventory"], credit=cogs)]
    return await post_source(bid, user, source_type="sale", source_id=sale["sale_id"],
                             source_number=sale["sale_number"], lines=lines,
                             narration=f"فاتورة مبيعات {sale['sale_number']}", date=sale.get("date"),
                             replace=replace, backfilled=backfilled)


async def reverse_sale(bid, user, sale: dict):
    return await reverse_source(bid, "sale", sale["sale_id"], user, f"قيد عكسي — فاتورة مبيعات {sale['sale_number']}")


async def post_purchase(bid, user, purchase: dict, *, replace=False, backfilled=False):
    m = await _accounts_map(bid)
    pm = purchase.get("payment_method", "cash")
    cr_acct = m["cash"] if pm == "cash" else m["accounts_payable"] if pm == "credit" else m["bank"]
    subtotal = round(purchase.get("subtotal", 0) or 0, 2)
    addl = round(purchase.get("additional_costs", 0) or 0, 2)
    total = round(purchase.get("total", 0) or (subtotal + addl), 2)
    lines = [_line(m["inventory"], debit=subtotal)]
    if addl > 0:
        lines.append(_line(m["purchase_shipping"], debit=addl))
    lines.append(_line(cr_acct, credit=total))
    return await post_source(bid, user, source_type="purchase", source_id=purchase["purchase_id"],
                             source_number=purchase["purchase_number"], lines=lines,
                             narration=f"فاتورة مشتريات {purchase['purchase_number']}", date=purchase.get("purchase_date"),
                             replace=replace, backfilled=backfilled)


async def reverse_purchase(bid, user, purchase: dict):
    return await reverse_source(bid, "purchase", purchase["purchase_id"], user, f"قيد عكسي — فاتورة مشتريات {purchase['purchase_number']}")


async def post_expense(bid, user, expense: dict, *, replace=False, backfilled=False):
    await seed_accounts(bid)
    acct = await _expense_account(bid, expense["category"])
    m = await _accounts_map(bid)
    pm = expense.get("payment_method", "cash")
    cr_acct = m["cash"] if pm == "cash" else m["accounts_payable"] if pm == "credit" else m["bank"]
    amount = round(expense.get("amount", 0) or 0, 2)
    lines = [_line(acct, debit=amount), _line(cr_acct, credit=amount)]
    return await post_source(bid, user, source_type="expense", source_id=expense["expense_id"],
                             source_number=expense["expense_id"], lines=lines,
                             narration=f"مصروف {expense['category']} · {expense['expense_id']}", date=expense.get("date"),
                             replace=replace, backfilled=backfilled)


async def reverse_expense(bid, user, expense: dict):
    return await reverse_source(bid, "expense", expense["expense_id"], user, f"قيد عكسي — مصروف {expense['expense_id']}")


async def post_return(bid, user, ret: dict, *, replace=False, backfilled=False):
    m = await _accounts_map(bid)
    rm = ret.get("refund_method", "cash")
    cr_acct = m["cash"] if rm == "cash" else m["bank"]
    refund = round(ret.get("refund_total", 0) or 0, 2)
    cogs_back = round(ret.get("cogs_reversed", 0) or 0, 2)
    lines = [_line(m["product_sales"], debit=refund), _line(cr_acct, credit=refund)]
    if ret.get("restock", True) and cogs_back > 0:
        lines += [_line(m["inventory"], debit=cogs_back), _line(m["cogs"], credit=cogs_back)]
    return await post_source(bid, user, source_type="return", source_id=ret["return_id"],
                             source_number=ret["return_number"], lines=lines,
                             narration=f"مرتجع {ret['return_number']}", date=ret.get("return_date"),
                             replace=replace, backfilled=backfilled)


async def reverse_return(bid, user, ret: dict):
    return await reverse_source(bid, "return", ret["return_id"], user, f"قيد عكسي — مرتجع {ret['return_number']}")


# ---------------------------------------------------------------- backfill

async def ensure_backfilled(bid: str) -> dict:
    """Idempotently post journal entries for historical confirmed documents."""
    stats = {"sales": 0, "purchases": 0, "expenses": 0, "returns": 0}
    async for s in db.sales.find({"business_id": bid, "status": "confirmed"}):
        if await _active_entry(bid, "sale", s["sale_id"]):
            continue
        await post_sale(bid, SYSTEM_USER, s, backfilled=True)
        stats["sales"] += 1
    async for p in db.purchases.find({"business_id": bid, "status": "confirmed"}):
        if await _active_entry(bid, "purchase", p["purchase_id"]):
            continue
        await post_purchase(bid, SYSTEM_USER, p, backfilled=True)
        stats["purchases"] += 1
    async for e in db.expenses.find({"business_id": bid}):
        if await _active_entry(bid, "expense", e["expense_id"]):
            continue
        await post_expense(bid, SYSTEM_USER, e, backfilled=True)
        stats["expenses"] += 1
    async for r in db.returns.find({"business_id": bid, "status": "confirmed"}):
        if await _active_entry(bid, "return", r["return_id"]):
            continue
        await post_return(bid, SYSTEM_USER, r, backfilled=True)
        stats["returns"] += 1
    await db.businesses.update_one({"business_id": bid}, {"$set": {"gl_backfilled_at": now_iso()}})
    return stats


# ---------------------------------------------------------------- statements

async def _account_totals(bid: str, from_date: Optional[str] = None, to_date: Optional[str] = None) -> dict:
    match: dict = {"business_id": bid}
    if from_date:
        match["date"] = {"$gte": from_date}
    if to_date:
        match.setdefault("date", {})["$lte"] = to_date + "\uffff"
    pipeline = [
        {"$match": match},
        {"$unwind": "$lines"},
        {"$group": {"_id": "$lines.account_id", "debit": {"$sum": "$lines.debit"}, "credit": {"$sum": "$lines.credit"}}},
    ]
    rows = await db.journal_entries.aggregate(pipeline).to_list(10000)
    return {r["_id"]: {"debit": round(r["debit"], 2), "credit": round(r["credit"], 2)} for r in rows}


async def _trial_rows(bid: str, from_date: Optional[str] = None, to_date: Optional[str] = None):
    totals = await _account_totals(bid, from_date, to_date)
    accounts = await db.accounts.find({"business_id": bid}, {"_id": 0}).sort("code", 1).to_list(1000)
    rows = []
    for a in accounts:
        t = totals.get(a["account_id"])
        if not t:
            continue
        rows.append({
            "account_id": a["account_id"], "code": a["code"], "name": a["name"], "group": a["group"],
            "debit": t["debit"], "credit": t["credit"], "balance": round(t["debit"] - t["credit"], 2),
        })
    return rows


def _income_from_rows(rows: list) -> dict:
    revenue = [{"account_id": r["account_id"], "code": r["code"], "name": r["name"], "amount": round(r["credit"] - r["debit"], 2)}
               for r in rows if r["group"] == "revenue"]
    cogs = [{"account_id": r["account_id"], "code": r["code"], "name": r["name"], "amount": round(r["debit"] - r["credit"], 2)}
            for r in rows if r["group"] == "cost_of_sales"]
    expenses = [{"account_id": r["account_id"], "code": r["code"], "name": r["name"], "amount": round(r["debit"] - r["credit"], 2)}
                for r in rows if r["group"] == "expenses"]
    revenue_total = round(sum(r["amount"] for r in revenue), 2)
    cogs_total = round(sum(r["amount"] for r in cogs), 2)
    expenses_total = round(sum(r["amount"] for r in expenses), 2)
    gross_profit = round(revenue_total - cogs_total, 2)
    return {
        "revenue": revenue, "revenue_total": revenue_total,
        "cost_of_sales": cogs, "cogs_total": cogs_total,
        "gross_profit": gross_profit,
        "expenses": expenses, "expenses_total": expenses_total,
        "net_income": round(gross_profit - expenses_total, 2),
    }


@router.get("/journal")
async def list_journal(user: dict = Depends(require_perm("accounts.view"))):
    await ensure_backfilled(user["business_id"])
    docs = await db.journal_entries.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@router.get("/trial-balance")
async def trial_balance(user: dict = Depends(require_perm("accounts.view"))):
    bid = user["business_id"]
    await ensure_backfilled(bid)
    rows = await _trial_rows(bid)
    td = round(sum(r["debit"] for r in rows), 2)
    tc = round(sum(r["credit"] for r in rows), 2)
    return {"rows": rows, "total_debit": td, "total_credit": tc, "balanced": abs(td - tc) < 0.005}


@router.get("/income-statement")
async def income_statement(from_date: Optional[str] = None, to_date: Optional[str] = None,
                           user: dict = Depends(require_perm("accounts.view"))):
    bid = user["business_id"]
    await ensure_backfilled(bid)
    rows = await _trial_rows(bid, from_date, to_date)
    return _income_from_rows(rows)


@router.get("/balance-sheet")
async def balance_sheet(user: dict = Depends(require_perm("accounts.view"))):
    bid = user["business_id"]
    await ensure_backfilled(bid)
    rows = await _trial_rows(bid)
    income = _income_from_rows(rows)
    assets = [{"account_id": r["account_id"], "code": r["code"], "name": r["name"], "amount": round(r["debit"] - r["credit"], 2)}
              for r in rows if r["group"] == "assets"]
    liabilities = [{"account_id": r["account_id"], "code": r["code"], "name": r["name"], "amount": round(r["credit"] - r["debit"], 2)}
                   for r in rows if r["group"] == "liabilities"]
    equity = [{"account_id": r["account_id"], "code": r["code"], "name": r["name"], "amount": round(r["credit"] - r["debit"], 2)}
              for r in rows if r["group"] == "equity"]
    total_assets = round(sum(r["amount"] for r in assets), 2)
    total_liabilities = round(sum(r["amount"] for r in liabilities), 2)
    total_equity = round(sum(r["amount"] for r in equity), 2)
    earnings = income["net_income"]
    return {
        "assets": assets, "total_assets": total_assets,
        "liabilities": liabilities, "total_liabilities": total_liabilities,
        "equity": equity, "total_equity": total_equity,
        "current_earnings": earnings,
        "total_liabilities_equity": round(total_liabilities + total_equity + earnings, 2),
        "balanced": abs(total_assets - (total_liabilities + total_equity + earnings)) < 0.005,
    }


@router.post("/backfill")
async def backfill(user: dict = Depends(require_perm("accounts.manage"))):
    stats = await ensure_backfilled(user["business_id"])
    await log_audit(user["business_id"], user, "ledger.backfill", "journal", "", str(stats))
    return stats
