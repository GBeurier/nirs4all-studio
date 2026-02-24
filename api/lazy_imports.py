"""Lazy import manager for nirs4all dependencies.

Provides two-phase startup:
- Phase 1 (core_ready): FastAPI running, workspace restored, basic endpoints work.
  All routers are registered but nirs4all imports are deferred.
- Phase 2 (ml_ready): All nirs4all dependencies loaded in background thread.
  Heavy pages (Playground, PipelineEditor, Training, etc.) now functional.
"""

import sys
import threading
import time
from pathlib import Path
from typing import Any, Optional

from .shared.logger import get_logger

logger = get_logger(__name__)

# Add nirs4all to path if needed (done once, early — no actual import)
_nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if _nirs4all_path.exists() and str(_nirs4all_path) not in sys.path:
    sys.path.insert(0, str(_nirs4all_path))

# --- State flags ---
_ml_ready = False
_ml_loading = False
_ml_error: Optional[str] = None
_ml_load_start_time: Optional[float] = None
_lock = threading.Lock()

# --- Cached imports (populated by background loader) ---
_cache: dict[str, Any] = {}


def is_ml_ready() -> bool:
    """Return True once all ML dependencies have been loaded."""
    return _ml_ready


def get_ml_status() -> dict:
    """Return detailed ML loading status."""
    elapsed = None
    if _ml_load_start_time is not None:
        elapsed = round(time.time() - _ml_load_start_time, 1)
    return {
        "ml_ready": _ml_ready,
        "ml_loading": _ml_loading,
        "ml_error": _ml_error,
        "elapsed_seconds": elapsed,
    }


def require_ml_ready():
    """Raise HTTP 503 if ML deps are not yet loaded."""
    if not _ml_ready:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=503,
            detail="ML dependencies are still loading. Please wait a moment and retry.",
            headers={"Retry-After": "5"},
        )


def get_cached(key: str) -> Any:
    """Get a lazily-cached import. Returns None if not yet loaded."""
    return _cache.get(key)


def _yield_gil():
    """Yield the GIL so uvicorn's event loop can process HTTP requests.

    Python holds the GIL during C extension imports (numpy, sklearn, scipy).
    Without yielding, the background import thread blocks the HTTP server
    from responding to health checks, making the app appear frozen.
    """
    time.sleep(0.05)


def _do_load_ml_deps():
    """Load all heavy nirs4all / sklearn / scipy dependencies in order."""
    global _ml_ready, _ml_loading, _ml_error, _ml_load_start_time

    with _lock:
        if _ml_ready or _ml_loading:
            return
        _ml_loading = True
        _ml_load_start_time = time.time()

    try:
        logger.info("Background ML dependency loading started...")

        # 1. Core nirs4all package (triggers numpy, sklearn, scipy)
        import nirs4all
        _cache["nirs4all"] = nirs4all
        _yield_gil()

        # 2. CONTROLLER_REGISTRY (heaviest single import — all model backends)
        from nirs4all.controllers import CONTROLLER_REGISTRY
        _cache["CONTROLLER_REGISTRY"] = CONTROLLER_REGISTRY
        _yield_gil()

        # 3. Pipeline components
        from nirs4all.pipeline.config import PipelineConfigs
        _cache["PipelineConfigs"] = PipelineConfigs

        from nirs4all.pipeline.config.generator import (
            ValidationResult,
            count_combinations,
            validate_spec,
        )
        _cache["ValidationResult"] = ValidationResult
        _cache["count_combinations"] = count_combinations
        _cache["validate_spec"] = validate_spec
        _yield_gil()

        # 4. Data components
        from nirs4all.data import DatasetConfigs
        from nirs4all.data.config_parser import parse_config
        from nirs4all.data.dataset import SpectroDataset
        from nirs4all.data.detection import detect_file_parameters
        from nirs4all.data.loaders import load_file
        from nirs4all.data.loaders.loader import handle_data
        from nirs4all.data.parsers.folder_parser import FolderParser
        _cache["DatasetConfigs"] = DatasetConfigs
        _cache["parse_config"] = parse_config
        _cache["SpectroDataset"] = SpectroDataset
        _cache["detect_file_parameters"] = detect_file_parameters
        _cache["load_file"] = load_file
        _cache["handle_data"] = handle_data
        _cache["FolderParser"] = FolderParser
        _yield_gil()

        # 5. Core / task detection
        from nirs4all.core.task_detection import detect_task_type
        from nirs4all.core.task_type import TaskType
        _cache["detect_task_type"] = detect_task_type
        _cache["TaskType"] = TaskType

        # 6. Core metrics
        from nirs4all.core.metrics import eval_multi, get_available_metrics
        _cache["eval_multi"] = eval_multi
        _cache["get_available_metrics"] = get_available_metrics
        _yield_gil()

        # 7. Operators
        from nirs4all.operators import models as nirs4all_models
        from nirs4all.operators import splitters as nirs_splitters
        from nirs4all.operators import transforms
        _cache["nirs4all_models"] = nirs4all_models
        _cache["nirs_splitters"] = nirs_splitters
        _cache["transforms"] = transforms
        _yield_gil()

        # 8. Augmentation
        from nirs4all.operators.augmentation import random as augmentation_random
        from nirs4all.operators.augmentation import spectral as augmentation_spectral
        _cache["augmentation_random"] = augmentation_random
        _cache["augmentation_spectral"] = augmentation_spectral
        _yield_gil()

        # 9. Filters
        try:
            from nirs4all.operators.filters import (
                HighLeverageFilter,
                SampleFilter,
                SpectralQualityFilter,
                XOutlierFilter,
                YOutlierFilter,
            )
            from nirs4all.operators.filters import MetadataFilter as N4AMetadataFilter
            _cache["SampleFilter"] = SampleFilter
            _cache["XOutlierFilter"] = XOutlierFilter
            _cache["YOutlierFilter"] = YOutlierFilter
            _cache["SpectralQualityFilter"] = SpectralQualityFilter
            _cache["HighLeverageFilter"] = HighLeverageFilter
            _cache["N4AMetadataFilter"] = N4AMetadataFilter
        except ImportError:
            logger.debug("nirs4all filter operators not available")
        _yield_gil()

        # 10. Storage (DuckDB)
        from nirs4all.pipeline.storage import WorkspaceStore
        _cache["WorkspaceStore"] = WorkspaceStore

        # 11. Bundle
        from nirs4all.pipeline.bundle import BundleLoader
        _cache["BundleLoader"] = BundleLoader

        # 12. Workspace
        from nirs4all import workspace as nirs4all_workspace
        _cache["nirs4all_workspace"] = nirs4all_workspace

        # 13. Predictions
        from nirs4all.data.predictions import Predictions
        _cache["Predictions"] = Predictions
        _yield_gil()

        # 14. Migration (optional)
        try:
            from nirs4all.pipeline.storage.migration import migrate_arrays_to_parquet
            _cache["migrate_arrays_to_parquet"] = migrate_arrays_to_parquet
        except ImportError:
            pass

        # 15. Synthesis
        try:
            from nirs4all.synthesis import (
                SyntheticDatasetBuilder,
                available_components,
                get_component,
                list_categories,
            )
            _cache["SyntheticDatasetBuilder"] = SyntheticDatasetBuilder
            _cache["available_components"] = available_components
            _cache["get_component"] = get_component
            _cache["list_categories"] = list_categories
        except ImportError:
            logger.debug("nirs4all synthesis not available")
        _yield_gil()

        # 16. Analysis / transfer / SHAP
        try:
            from nirs4all.analysis.presets import PRESETS, list_presets
            from nirs4all.analysis.transfer_utils import get_base_preprocessings
            from nirs4all.visualization.analysis.transfer import PreprocPCAEvaluator
            _cache["PRESETS"] = PRESETS
            _cache["list_presets"] = list_presets
            _cache["get_base_preprocessings"] = get_base_preprocessings
            _cache["PreprocPCAEvaluator"] = PreprocPCAEvaluator
        except ImportError:
            logger.debug("nirs4all transfer analysis not available")
        _yield_gil()

        try:
            from nirs4all.visualization.analysis.shap import SHAP_AVAILABLE, ShapAnalyzer
            _cache["SHAP_AVAILABLE"] = SHAP_AVAILABLE
            _cache["ShapAnalyzer"] = ShapAnalyzer
        except ImportError:
            _cache["SHAP_AVAILABLE"] = False
            logger.debug("nirs4all SHAP not available")
        _yield_gil()

        # 17. sklearn imports used directly by routers
        try:
            from sklearn.decomposition import PCA
            from sklearn.manifold import TSNE
            from sklearn.metrics import confusion_matrix as sklearn_confusion_matrix
            from sklearn.model_selection import KFold, cross_val_predict, cross_val_score
            from sklearn.base import TransformerMixin
            _cache["PCA"] = PCA
            _cache["TSNE"] = TSNE
            _cache["sklearn_confusion_matrix"] = sklearn_confusion_matrix
            _cache["KFold"] = KFold
            _cache["cross_val_predict"] = cross_val_predict
            _cache["cross_val_score"] = cross_val_score
            _cache["TransformerMixin"] = TransformerMixin
        except ImportError:
            logger.debug("sklearn not available")

        # 18. scipy
        try:
            from scipy import stats
            from scipy.signal import find_peaks
            _cache["scipy_stats"] = stats
            _cache["scipy_find_peaks"] = find_peaks
        except ImportError:
            logger.debug("scipy not available")

        # 19. joblib
        try:
            import joblib
            _cache["joblib"] = joblib
        except ImportError:
            logger.debug("joblib not available")

        elapsed = round(time.time() - _ml_load_start_time, 1)
        logger.info("ML dependencies loaded successfully in %.1fs", elapsed)

        _ml_ready = True
        _ml_loading = False
    except Exception as e:
        _ml_error = str(e)
        _ml_loading = False
        logger.error("Failed to load ML dependencies: %s", e, exc_info=True)


def start_ml_loading():
    """Start loading ML dependencies in a background thread."""
    thread = threading.Thread(target=_do_load_ml_deps, name="ml-loader", daemon=True)
    thread.start()
