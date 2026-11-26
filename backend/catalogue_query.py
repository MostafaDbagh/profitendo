"""Shared traversal for legacy product and inventory lists."""
import re

from fastapi import HTTPException

from core import db


async def catalogue_rows(business_id, page, page_size, search, *, include_archived):
    if page is not None and not 1 <= page <= 2_147_483_647:
        raise HTTPException(status_code=422, detail="Page must be between 1 and 2147483647")
    if not 1 <= page_size <= 500:
        raise HTTPException(status_code=422, detail="Page size must be between 1 and 500")
    query = {"business_id": business_id}
    if not include_archived:
        query["archived"] = {"$ne": True}
    if search and search.strip():
        pattern = {"$regex": re.escape(search.strip()), "$options": "i"}
        query["$or"] = [{"name": pattern}, {"sku": pattern}]
    cursor = db.products.find(query, {"_id": 0}).sort("_id", 1)
    if page is None:
        # Existing clients filter and paginate the entire returned array.
        return await cursor.to_list(None)
    return await cursor.skip((page - 1) * page_size).limit(page_size).to_list(page_size)
