"""Propagate a single Motor transaction through a financial posting and its ledger helpers."""
from contextvars import ContextVar
from functools import partial, wraps

from fastapi import HTTPException
from pymongo.errors import ConfigurationError, OperationFailure
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern


_session = ContextVar("posting_session", default=None)


class _SessionCollection:
    def __init__(self, collection, session):
        self.collection = collection
        self.session = session

    def __getattr__(self, method):
        return partial(getattr(self.collection, method), session=self.session)


class PostingDatabase:
    def __init__(self, database):
        self.database = database

    def __getitem__(self, name):
        collection = self.database[name]
        session = _session.get()
        return _SessionCollection(collection, session) if session is not None else collection

    def __getattr__(self, name):
        return self[name]


def in_posting_transaction():
    return _session.get() is not None


def transactional(client):
    def decorate(operation):
        @wraps(operation)
        async def run(*args, **kwargs):
            if in_posting_transaction():
                return await operation(*args, **kwargs)

            async def callback(session):
                token = _session.set(session)
                try:
                    return await operation(*args, **kwargs)
                finally:
                    _session.reset(token)

            try:
                async with await client.start_session() as session:
                    return await session.with_transaction(
                        callback, read_concern=ReadConcern("snapshot"),
                        write_concern=WriteConcern("majority"),
                    )
            except (ConfigurationError, OperationFailure) as exc:
                if getattr(exc, "code", None) == 20 or "does not support sessions" in str(exc):
                    raise HTTPException(503, "Financial posting requires a transaction-capable MongoDB replica set or mongos") from exc
                raise
        return run
    return decorate
