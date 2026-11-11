"""Test environment bootstrap only. MUST NOT touch the production owner account.

Tests authenticate as the disposable test tenant: test.seller@profitlens.app / TestSeller123!
"""
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
