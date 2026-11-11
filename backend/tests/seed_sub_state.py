#!/usr/bin/env python3
"""Seed helper for iter22 subscription UI tests. Usage: python seed_sub_state.py <state>
states: active_monthly | cancel_scheduled | unverified | trial(clear)
Also seeds subscription_payments for active states.
"""
import os, sys, asyncio
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
BID = "biz_7101d3986f3c"
FULL_ID = "I-UITEST1234567890"

async def main():
    state = sys.argv[1] if len(sys.argv) > 1 else "trial"
    cli = AsyncIOMotorClient(MONGO_URL)
    db = cli[DB_NAME]
    now_dt = datetime.now(timezone.utc)
    now = now_dt.isoformat()
    def plus(days): return (now_dt + timedelta(days=days)).isoformat()
    if state == "trial":
        await db.businesses.update_one({"business_id": BID}, {"$unset": {"assistant_subscription": ""}})
        await db.subscription_payments.delete_many({"business_id": BID, "reference_id": FULL_ID})
        print("cleared → trial/free")
    elif state == "active_monthly":
        sub = {
            "plan": "monthly", "price": 29, "currency": "USD", "status": "active",
            "paypal_subscription_id": FULL_ID,
            "cancel_at_period_end": False, "cancelled_at": None,
            "started_at": now, "subscribed_at": now,
            "current_period_start": now, "current_period_end": plus(30),
        }
        await db.businesses.update_one({"business_id": BID}, {"$set": {"assistant_subscription": sub}})
        await db.subscription_payments.delete_many({"business_id": BID, "reference_id": FULL_ID})
        await db.subscription_payments.insert_one({
            "payment_id": "PMT-UITEST-1", "business_id": BID, "reference_id": FULL_ID,
            "plan": "monthly", "amount": 29, "currency": "USD", "status": "completed",
            "created_at": now, "period_start": now, "period_end": plus(30),
        })
        print("seeded active_monthly")
    elif state == "cancel_scheduled":
        sub = {
            "plan": "monthly", "price": 29, "currency": "USD", "status": "active",
            "paypal_subscription_id": FULL_ID,
            "cancel_at_period_end": True, "cancelled_at": now,
            "started_at": plus(-10), "subscribed_at": plus(-10),
            "current_period_start": plus(-10),
            "current_period_end": plus(20),
        }
        await db.businesses.update_one({"business_id": BID}, {"$set": {"assistant_subscription": sub}})
        print("seeded cancel_scheduled")
    elif state == "unverified":
        sub = {
            "plan": "monthly", "price": 29, "currency": "USD", "status": "active",
            "paypal_subscription_id": None,
            "cancel_at_period_end": False, "cancelled_at": None,
            "started_at": now, "subscribed_at": now,
            "current_period_start": now, "current_period_end": plus(30),
        }
        await db.businesses.update_one({"business_id": BID}, {"$set": {"assistant_subscription": sub}})
        print("seeded unverified (no paypal_subscription_id)")
    else:
        print(f"unknown state {state}")
    cli.close()

asyncio.run(main())
