"""Opt-in legacy write freeze during the new system's cutover."""
SESSION_ROUTES = frozenset({"/api/auth/login", "/api/auth/logout", "/api/auth/pin/verify"})


def allow_legacy_request(method: str, path: str, read_only: bool) -> bool:
    if not read_only or method in {"GET", "HEAD", "OPTIONS"}:
        return True
    return method == "POST" and path in SESSION_ROUTES
