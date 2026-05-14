"""JSON-serialization helpers for analytics / tool outputs."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any


def jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)
