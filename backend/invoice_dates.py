import re
from datetime import date, datetime


def invoice_date(value):
    """Accept ISO dates and slash dates with only one calendar interpretation."""
    if value is None or not str(value).strip():
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    raw = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return date.fromisoformat(raw).isoformat()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?", raw):
        return datetime.fromisoformat(raw).date().isoformat()
    match = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", raw)
    if match:
        a, b, year = map(int, match.groups())
        if a == b or a > 12:
            return date(year, b, a).isoformat()
        if b > 12:
            return date(year, a, b).isoformat()
    raise ValueError("Invalid or ambiguous invoice date")
