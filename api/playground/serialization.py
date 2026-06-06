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

try:
    import orjson
    ORJSON_AVAILABLE = True
except ImportError:
    ORJSON_AVAILABLE = False


def _orjson_numpy_default(obj: Any) -> Any:
    """Fallback for values orjson cannot serialize natively.

    OPT_SERIALIZE_NUMPY covers numeric/bool ndarrays zero-copy; non-numeric
    arrays (string/object metadata columns) and exotic numpy scalars land here
    and are converted exactly as the previous jsonable_encoder flow did.
    """
    import numpy as np

    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, np.generic):
        return obj.item()
    raise TypeError(f"Type is not JSON serializable: {type(obj)}")


class NumpyORJSONResponse(Response):
    """ORJSON response that serializes numpy arrays/scalars natively.

    ``orjson.OPT_SERIALIZE_NUMPY`` writes ndarrays straight from the buffer
    (no ``.tolist()`` copy, no per-element Python objects) and emits
    NaN/Infinity as ``null`` — byte-identical wire format to the previous
    jsonable_encoder + ORJSONResponse flow for these payloads.
    """

    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return orjson.dumps(content, option=orjson.OPT_SERIALIZE_NUMPY, default=_orjson_numpy_default)


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
    if ORJSON_AVAILABLE:
        # Serialize directly with numpy support (PG-07): the payload was already
        # validated at construction (ExecuteResponse(...)), so skipping the
        # response_model re-validation + jsonable_encoder pass changes nothing
        # on the wire — it only removes the full-matrix Python-object copies.
        # The msgpack branch above has always bypassed response_model the same way.
        if isinstance(data, BaseModel):
            data = data.model_dump(mode="python")
        return NumpyORJSONResponse(data)
    # orjson unavailable: return the dict unchanged — FastAPI handles
    # response_model + JSONResponse (numpy must be pre-converted upstream).
    return data
