"""``n4a`` -- additive brand facade over the nirs4all aggregate distribution.

``n4a`` is the short, brand-aligned import root ("n4a" = nirs4all) for the
portable nirs4all aggregate. It re-exports the full public surface of the
aggregate -- shipped as the ``nirs4all-core`` distribution and the
``nirs4all_core`` import package -- and adds no behavior of its own. Importing
``n4a`` is equivalent to importing ``nirs4all_core``::

    import n4a

    n4a.upstream_status()
    n4a.load_pipeline_definition(config)

LOCK-GOV / GOV-004 naming note: the ``n4a`` stem appears in three distinct
places across the ecosystem. They are intentionally consistent ("n4a" =
"nirs4all") but address different layers:

* ``n4a`` (this module) -- the Python *import facade* for the aggregate;
* ``.n4a`` -- the pipeline/bundle *file extension* used by the full
  ``nirs4all`` library;
* ``n4a-datasets`` -- the *console script* shipped by ``nirs4all-datasets``.

This facade is additive and deliberately does not shadow the full Python
``nirs4all`` library.
"""

from __future__ import annotations

from typing import Any

import nirs4all_core as _aggregate

#: Import package currently backing this facade.
__aggregate_import__ = _aggregate.__name__
__version__ = _aggregate.__version__

__all__ = list(_aggregate.__all__)

for _name in __all__:
    globals()[_name] = getattr(_aggregate, _name)


def __getattr__(name: str) -> Any:
    """Forward any non-re-exported attribute to the backing aggregate package.

    PEP 562 hook so the facade stays a faithful, additive mirror: future public
    additions to the aggregate (and its internal submodules) remain reachable
    through ``n4a`` without an explicit edit here.
    """

    return getattr(_aggregate, name)
