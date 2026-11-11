"""Iter24: PayPal configuration flow — env vars -> config parser -> plan availability.

Proves that when PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_PLAN_MONTHLY and
PAYPAL_PLAN_YEARLY are present in the environment, BOTH plans evaluate AVAILABLE and
the correct PayPal base URL is selected per PAYPAL_MODE. Runs in-process (module
reload with patched env); the running server is untouched. Dummy values only.
"""
import importlib
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

KEYS = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_PLAN_MONTHLY", "PAYPAL_PLAN_YEARLY", "PAYPAL_MODE", "PAYPAL_WEBHOOK_ID"]

FULL_ENV = {
    "PAYPAL_CLIENT_ID": "DUMMY_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET": "DUMMY_SECRET",
    "PAYPAL_PLAN_MONTHLY": "P-DUMMYMONTHLY",
    "PAYPAL_PLAN_YEARLY": "P-DUMMYYEARLY",
    "PAYPAL_WEBHOOK_ID": "WH-DUMMY",
}


@pytest.fixture()
def reload_subs():
    import subscriptions

    saved = {k: os.environ.get(k) for k in KEYS}

    def _with(env):
        for k in KEYS:
            if k in env:
                os.environ[k] = env[k]
            else:
                os.environ.pop(k, None)
        return importlib.reload(subscriptions)

    yield _with

    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    importlib.reload(subscriptions)


def test_full_config_both_plans_available_live_mode(reload_subs):
    m = reload_subs({**FULL_ENV, "PAYPAL_MODE": "live"})
    assert m.paypal_configured() is True
    assert m.PLANS["monthly"]["plan_id"] == "P-DUMMYMONTHLY"
    assert m.PLANS["yearly"]["plan_id"] == "P-DUMMYYEARLY"
    assert m.PAYPAL_BASE == "https://api-m.paypal.com"
    assert m.PAYPAL_WEBHOOK_ID == "WH-DUMMY"


def test_full_config_sandbox_mode(reload_subs):
    m = reload_subs({**FULL_ENV, "PAYPAL_MODE": "sandbox"})
    assert m.paypal_configured() is True
    assert m.PAYPAL_BASE == "https://api-m.sandbox.paypal.com"


def test_missing_secret_not_configured(reload_subs):
    env = {k: v for k, v in FULL_ENV.items() if k != "PAYPAL_CLIENT_SECRET"}
    m = reload_subs(env)
    assert m.paypal_configured() is False
    # Plan IDs still parsed (availability is independent of the secret)
    assert m.PLANS["monthly"]["plan_id"] == "P-DUMMYMONTHLY"


def test_missing_yearly_plan_only_monthly_available(reload_subs):
    env = {k: v for k, v in FULL_ENV.items() if k != "PAYPAL_PLAN_YEARLY"}
    m = reload_subs(env)
    assert m.paypal_configured() is True
    assert m.PLANS["monthly"]["plan_id"] == "P-DUMMYMONTHLY"
    assert m.PLANS["yearly"]["plan_id"] is None


def test_mode_defaults_to_sandbox_when_unset(reload_subs):
    env = {k: v for k, v in FULL_ENV.items() if k != "PAYPAL_MODE"}
    m = reload_subs(env)
    assert m.PAYPAL_BASE == "https://api-m.sandbox.paypal.com"
