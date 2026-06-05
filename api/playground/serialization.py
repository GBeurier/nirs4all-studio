"""Response serialization helpers for the playground API.

Negotiates MessagePack vs JSON based on the client's ``Accept`` header and
provides the numpy fallback serializer for MessagePack.
"""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import Response
from pydantic import BaseModel

try:
    import msgpack
    MSGPACK_AVAILABLE = True
except ImportError:
    MSGPACK_AVAILABLE = False


def msgpack_default(obj: Any) -> Any:
    """Fallback serializer for msgpack — handles numpy types."""
    import numpy as np
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    raise TypeError(f"Unknown type for msgpack: {type(obj)}")


def negotiate_response(data: dict, http_request: Request) -> Response | dict:
    """Return MessagePack or JSON response based on Accept header.

    When the client sends ``Accept: application/x-msgpack``, the response is
    serialized with MessagePack (binary, ~40-50 % smaller than JSON for numeric
    arrays, and significantly faster to parse on the frontend). Falls back to
    the normal FastAPI response_model + ORJSONResponse flow otherwise.
    """
    accept = http_request.headers.get("accept", "")
    if MSGPACK_AVAILABLE and "application/x-msgpack" in accept:
        # Convert Pydantic models to plain dicts for msgpack
        if isinstance(data, BaseModel):
            data = data.model_dump(mode="python")
        packed = msgpack.packb(data, default=msgpack_default, use_bin_type=True)
        return Response(content=packed, media_type="application/x-msgpack")
    # Return the dict unchanged — FastAPI handles response_model + ORJSONResponse.
    return data
