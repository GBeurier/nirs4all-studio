#!/usr/bin/env python3
"""Generate a comprehensive extended NodeDefinition[] registry JSON.

This script generates a full catalog of operators for the webapp's extended mode:
- sklearn transformers
- sklearn regressors and classifiers
- sklearn splitters
- nirs4all operators (preprocessing, augmentation, splitters)
- TensorFlow models

The output matches the webapp's NodeDefinition schema at:
  src/data/nodes/schema/node.schema.json

Usage:
  python scripts/generate_extended_registry.py \
    --out public/node-registry/extended.json \
    --validate

Validation uses the Node validator:
  node scripts/validate-node-registry.cjs <file>
"""

from __future__ import annotations

import argparse
import inspect
import json
import math
import re
import subprocess
import sys
from datetime import UTC, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# ============================================================================
# Utilities
# ============================================================================


def snake_case(name: str) -> str:
    """Convert CamelCase or PascalCase to snake_case."""
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\g<1>_\g<2>", name)
    s2 = re.sub(r"([a-z0-9])([A-Z])", r"\g<1>_\g<2>", s1)
    s2 = s2.lower()
    return re.sub(r"[^a-z0-9_]+", "_", s2).strip("_")


def safe_first_line(doc: str | None) -> str:
    """Get the first non-empty line of a docstring."""
    if not doc:
        return ""
    line = doc.strip().splitlines()[0].strip()
    return line[:200]


def module_prefix(module: str) -> str:
    """Get the top two segments of a module path."""
    parts = module.split(".")
    return ".".join(parts[:2]) if len(parts) >= 2 else module


def jsonable_default(value: Any) -> tuple[bool, Any]:
    """Check if a value can be serialized to JSON and return sanitized version."""
    if value is inspect._empty:
        return False, None
    if isinstance(value, bool):
        return True, value
    if isinstance(value, int):
        return True, value
    if isinstance(value, float):
        if not math.isfinite(value):
            return False, None
        return True, value
    if isinstance(value, str) or value is None:
        return True, value
    if isinstance(value, (list, tuple)):
        sanitized = []
        for v in value:
            ok, sv = jsonable_default(v)
            if ok:
                sanitized.append(sv)
            else:
                return False, None
        return True, sanitized
    if isinstance(value, dict):
        sanitized = {}
        for k, v in value.items():
            ok, sv = jsonable_default(v)
            if ok:
                sanitized[str(k)] = sv
            else:
                return False, None
        return True, sanitized
    # Try numpy types
    try:
        import numpy as np

        if isinstance(value, np.generic):
            return jsonable_default(value.item())
        if isinstance(value, np.ndarray):
            return jsonable_default(value.tolist())
    except ImportError:
        pass

    # Non-serializable - return repr
    try:
        json.dumps(value, allow_nan=False)
        return True, value
    except Exception:
        return False, None


def infer_param_type(default: Any) -> str:
    """Infer parameter type from default value. Returns webapp schema types."""
    if isinstance(default, bool):
        return "bool"
    if isinstance(default, int) and not isinstance(default, bool):
        return "int"
    if isinstance(default, float):
        return "float"
    if isinstance(default, str):
        return "string"
    if isinstance(default, (list, tuple)):
        return "array"
    if isinstance(default, dict):
        return "object"
    # None or unknown types default to string
    return "string"


def build_parameters(cls: type) -> list[dict[str, Any]]:
    """Extract parameters from a class's __init__ signature."""
    params: list[dict[str, Any]] = []

    try:
        sig = inspect.signature(cls.__init__)
    except Exception:
        return params

    for name, p in sig.parameters.items():
        if name in {"self", "cls"}:
            continue
        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue

        has_default, default_value = jsonable_default(p.default)
        param_type = infer_param_type(p.default if p.default is not inspect._empty else None)

        entry: dict[str, Any] = {
            "name": name,
            "type": param_type,
            # Mark all generated params as advanced to reduce noise
            "isAdvanced": True,
        }

        if has_default:
            entry["default"] = default_value

        # Mark required when no default
        if p.default is inspect._empty:
            entry["required"] = True

        params.append(entry)

    return params


# ============================================================================
# Subcategory Mappings
# ============================================================================

# Mapping module paths to webapp-compatible subcategory names
TRANSFORMER_SUBCATEGORY_MAP = {
    "sklearn.preprocessing": "scikit-scalers",
    "sklearn.impute": "scikit-imputation",
    "sklearn.decomposition": "scikit-dimensionality",
    "sklearn.manifold": "scikit-dimensionality",
    "sklearn.cross_decomposition": "scikit-dimensionality",
    "sklearn.feature_selection": "scikit-feature-selection",
    "sklearn.kernel_approximation": "scikit-kernel-projection",
    "sklearn.random_projection": "scikit-kernel-projection",
    "sklearn.feature_extraction": "scikit-feature-extraction",
    "sklearn.cluster": "scikit-cluster-neighbors",
    "sklearn.neighbors": "scikit-cluster-neighbors",
    "sklearn.compose": "scikit-meta-transformers",
    "sklearn.pipeline": "scikit-meta-transformers",
}

MODEL_SUBCATEGORY_MAP = {
    "sklearn.linear_model": "sklearn-linear",
    "sklearn.svm": "sklearn-svm",
    "sklearn.tree": "sklearn-tree",
    "sklearn.ensemble": "sklearn-ensemble",
    "sklearn.neighbors": "sklearn-neighbors",
    "sklearn.naive_bayes": "sklearn-naive-bayes",
    "sklearn.discriminant_analysis": "sklearn-discriminant",
    "sklearn.gaussian_process": "sklearn-gaussian-process",
    "sklearn.kernel_ridge": "sklearn-kernel",
    "sklearn.neural_network": "sklearn-neural",
    "sklearn.calibration": "sklearn-probabilistic",
    "sklearn.isotonic": "sklearn-probabilistic",
    "sklearn.cross_decomposition": "sklearn-cross-decomposition",
    "sklearn.multiclass": "sklearn-meta",
    "sklearn.multioutput": "sklearn-meta",
    "sklearn.semi_supervised": "sklearn-semi-supervised",
    "sklearn.dummy": "sklearn-baseline",
}


def get_transformer_subcategory(module: str) -> str:
    """Map sklearn module to transformer subcategory."""
    pref = module_prefix(module)
    if pref == "sklearn.preprocessing":
        # Distinguish encoding from scaling
        if "_encod" in module or "_label" in module or "_discretization" in module:
            return "scikit-encoding"
        return "scikit-scalers"
    return TRANSFORMER_SUBCATEGORY_MAP.get(pref, "scikit-misc-transformers")


def get_model_subcategory(module: str) -> str:
    """Map sklearn module to model subcategory."""
    pref = module_prefix(module)
    # Check for classification threshold in module
    if "classification_threshold" in module:
        return "sklearn-probabilistic"
    return MODEL_SUBCATEGORY_MAP.get(pref, "sklearn-misc-models")


# ============================================================================
# Sklearn Node Generation
# ============================================================================


def generate_sklearn_transformers() -> list[dict[str, Any]]:
    """Generate nodes for all sklearn transformers."""
    try:
        from sklearn.utils import all_estimators
    except ImportError:
        print("[WARN] sklearn not available, skipping transformers", file=sys.stderr)
        return []

    nodes: list[dict[str, Any]] = []
    seen: set[str] = set()

    for name, cls in all_estimators(type_filter="transformer"):
        slug = snake_case(name)
        if not slug or slug in seen:
            continue
        seen.add(slug)

        module = getattr(cls, "__module__", "")
        class_path = f"{module}.{name}" if module else None
        category = get_transformer_subcategory(module)
        description = safe_first_line(getattr(cls, "__doc__", None))
        if not description:
            description = f"sklearn transformer {name}"

        nodes.append({
            "id": f"preprocessing.{slug}",
            "name": name,
            "type": "preprocessing",
            "description": description,
            "parameters": build_parameters(cls),
            "source": "sklearn",
            "classPath": class_path,
            "category": category,
            "tags": ["generated", "sklearn", "transformer"] + module.split(".")[1:3],
            "isAdvanced": True,
        })

    return nodes


def generate_sklearn_models() -> list[dict[str, Any]]:
    """Generate nodes for all sklearn classifiers and regressors."""
    try:
        from sklearn.utils import all_estimators
    except ImportError:
        print("[WARN] sklearn not available, skipping models", file=sys.stderr)
        return []

    # Collect both types for estimators that support both
    info: dict[str, dict[str, Any]] = {}
    for est_type in ("classifier", "regressor"):
        for name, cls in all_estimators(type_filter=est_type):
            entry = info.setdefault(name, {"cls": cls, "types": set()})
            entry["types"].add(est_type)

    nodes: list[dict[str, Any]] = []
    seen: set[str] = set()

    for name, entry in info.items():
        slug = snake_case(name)
        if not slug or slug in seen:
            continue
        seen.add(slug)

        cls = entry["cls"]
        module = getattr(cls, "__module__", "")
        class_path = f"{module}.{name}" if module else None
        category = get_model_subcategory(module)

        est_types = sorted(entry["types"])
        type_label = ", ".join(est_types)
        description = safe_first_line(getattr(cls, "__doc__", None))
        if not description:
            description = f"sklearn {type_label} {name}"

        nodes.append({
            "id": f"model.{slug}",
            "name": name,
            "type": "model",
            "description": description,
            "parameters": build_parameters(cls),
            "source": "sklearn",
            "classPath": class_path,
            "category": category,
            "tags": ["generated", "sklearn"] + est_types + module.split(".")[1:3],
            "isAdvanced": True,
        })

    return nodes


def generate_sklearn_splitters() -> list[dict[str, Any]]:
    """Generate nodes for sklearn cross-validation splitters."""
    try:
        import sklearn.model_selection as model_selection
    except ImportError:
        print("[WARN] sklearn not available, skipping splitters", file=sys.stderr)
        return []

    # Known splitters from sklearn.model_selection
    splitters = [
        "KFold",
        "StratifiedKFold",
        "GroupKFold",
        "RepeatedKFold",
        "RepeatedStratifiedKFold",
        "ShuffleSplit",
        "StratifiedShuffleSplit",
        "GroupShuffleSplit",
        "TimeSeriesSplit",
        "LeaveOneOut",
        "LeavePOut",
        "LeaveOneGroupOut",
        "LeavePGroupsOut",
        "PredefinedSplit",
        "StratifiedGroupKFold",
    ]

    nodes: list[dict[str, Any]] = []

    for name in splitters:
        cls = getattr(model_selection, name, None)
        if cls is None:
            continue

        slug = snake_case(name)
        module = getattr(cls, "__module__", "sklearn.model_selection")
        class_path = f"{module}.{name}"
        description = safe_first_line(getattr(cls, "__doc__", None))
        if not description:
            description = f"sklearn splitter {name}"

        nodes.append({
            "id": f"splitting.{slug}",
            "name": name,
            "type": "splitting",
            "description": description,
            "parameters": build_parameters(cls),
            "source": "sklearn",
            "classPath": class_path,
            "category": "sklearn-splitters",
            "tags": ["generated", "sklearn", "splitter", "cross-validation"],
            "isAdvanced": True,
        })

    return nodes


# ============================================================================
# nirs4all Node Generation
# ============================================================================

# Map nirs4all operators to webapp node types and categories
NIRS4ALL_OPERATORS = {
    # Preprocessing - scatter correction
    "nirs4all.operators.transforms.scalers.StandardNormalVariate": {
        "type": "preprocessing",
        "category": "scatter-correction",
        "name": "StandardNormalVariate",
        "description": "Row-wise standardization (SNV)",
    },
    "nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection": {
        "type": "preprocessing",
        "category": "scatter-correction",
        "name": "MSC",
        "description": "Multiplicative scatter correction",
    },
    "nirs4all.operators.transforms.scalers.RobustNormalVariate": {
        "type": "preprocessing",
        "category": "scatter-correction",
        "name": "RobustNormalVariate",
        "description": "Robust row-wise scaling",
    },
    # Preprocessing - baseline
    "nirs4all.operators.transforms.signal.Baseline": {
        "type": "preprocessing",
        "category": "baseline-correction",
        "name": "Baseline",
        "description": "Polynomial baseline correction",
    },
    "nirs4all.operators.transforms.signal.Detrend": {
        "type": "preprocessing",
        "category": "baseline-correction",
        "name": "Detrend",
        "description": "Remove linear or constant trends",
    },
    # Preprocessing - smoothing
    "nirs4all.operators.transforms.nirs.SavitzkyGolay": {
        "type": "preprocessing",
        "category": "smoothing",
        "name": "SavitzkyGolay",
        "description": "Savitzky-Golay smoothing and derivatives",
    },
    "nirs4all.operators.transforms.signal.Gaussian": {
        "type": "preprocessing",
        "category": "smoothing",
        "name": "Gaussian",
        "description": "Gaussian smoothing filter",
    },
    # Preprocessing - derivatives
    "nirs4all.operators.transforms.nirs.FirstDerivative": {
        "type": "preprocessing",
        "category": "derivatives",
        "name": "FirstDerivative",
        "description": "First derivative along wavelengths",
    },
    "nirs4all.operators.transforms.nirs.SecondDerivative": {
        "type": "preprocessing",
        "category": "derivatives",
        "name": "SecondDerivative",
        "description": "Second derivative along wavelengths",
    },
    "nirs4all.operators.transforms.scalers.Derivate": {
        "type": "preprocessing",
        "category": "derivatives",
        "name": "Derivate",
        "description": "Derivative along sample axis",
    },
    # Preprocessing - transforms
    "nirs4all.operators.transforms.nirs.Haar": {
        "type": "preprocessing",
        "category": "spectral-transforms",
        "name": "Haar",
        "description": "Haar wavelet decomposition",
    },
    "nirs4all.operators.transforms.nirs.LogTransform": {
        "type": "preprocessing",
        "category": "spectral-transforms",
        "name": "LogTransform",
        "description": "Logarithmic scaling of spectra",
    },
    # Preprocessing - scalers
    "nirs4all.operators.transforms.scalers.Normalize": {
        "type": "preprocessing",
        "category": "nirs-scalers",
        "name": "Normalize",
        "description": "Row-wise normalization across wavelengths",
    },
    "nirs4all.operators.transforms.scalers.SimpleScale": {
        "type": "preprocessing",
        "category": "nirs-scalers",
        "name": "SimpleScale",
        "description": "Scale by constant factors",
    },
    # Preprocessing - resampling
    "nirs4all.operators.transforms.features.CropTransformer": {
        "type": "preprocessing",
        "category": "resampling-alignment",
        "name": "CropTransformer",
        "description": "Crop spectra to wavelength ranges",
    },
    "nirs4all.operators.transforms.features.ResampleTransformer": {
        "type": "preprocessing",
        "category": "resampling-alignment",
        "name": "ResampleTransformer",
        "description": "Resample spectra to custom grids",
    },
    "nirs4all.operators.transforms.resampler.Resampler": {
        "type": "preprocessing",
        "category": "resampling-alignment",
        "name": "Resampler",
        "description": "Adaptive resampling controller",
    },
    # Augmentation - random
    "nirs4all.operators.augmentation.random.Rotate_Translate": {
        "type": "augmentation",
        "category": "spectral-augmentation",
        "name": "RotateTranslate",
        "description": "Random affine spectral augmentation",
    },
    "nirs4all.operators.augmentation.random.Random_X_Operation": {
        "type": "augmentation",
        "category": "spectral-augmentation",
        "name": "RandomXOperation",
        "description": "Random multiplicative/additive perturbations",
    },
    # Augmentation - splines
    "nirs4all.operators.augmentation.splines.Spline_Smoothing": {
        "type": "augmentation",
        "category": "spectral-augmentation",
        "name": "SplineSmoothing",
        "description": "Spline-based smoothing augmentation",
    },
    "nirs4all.operators.augmentation.splines.Spline_X_Perturbations": {
        "type": "augmentation",
        "category": "spectral-augmentation",
        "name": "SplineXPerturbations",
        "description": "Wavelength warping via splines",
    },
    "nirs4all.operators.augmentation.splines.Spline_Y_Perturbations": {
        "type": "augmentation",
        "category": "spectral-augmentation",
        "name": "SplineYPerturbations",
        "description": "Intensity perturbations via splines",
    },
    "nirs4all.operators.augmentation.splines.Spline_X_Simplification": {
        "type": "augmentation",
        "category": "spectral-augmentation",
        "name": "SplineXSimplification",
        "description": "X-axis simplification via splines",
    },
    "nirs4all.operators.augmentation.splines.Spline_Curve_Simplification": {
        "type": "augmentation",
        "category": "spectral-augmentation",
        "name": "SplineCurveSimplification",
        "description": "Curve simplification via splines",
    },
    # Augmentation - spectral noise
    "nirs4all.operators.augmentation.spectral.GaussianAdditiveNoise": {
        "type": "augmentation",
        "category": "spectral-noise",
        "name": "GaussianAdditiveNoise",
        "description": "Gaussian additive noise with optional smoothing",
    },
    "nirs4all.operators.augmentation.spectral.MultiplicativeNoise": {
        "type": "augmentation",
        "category": "spectral-noise",
        "name": "MultiplicativeNoise",
        "description": "Multiplicative gain noise per sample or wavelength",
    },
    "nirs4all.operators.augmentation.spectral.SpikeNoise": {
        "type": "augmentation",
        "category": "spectral-noise",
        "name": "SpikeNoise",
        "description": "Random spike artifacts at random positions",
    },
    # Augmentation - spectral baseline drift
    "nirs4all.operators.augmentation.spectral.LinearBaselineDrift": {
        "type": "augmentation",
        "category": "spectral-baseline",
        "name": "LinearBaselineDrift",
        "description": "Linear baseline drift augmentation",
    },
    "nirs4all.operators.augmentation.spectral.PolynomialBaselineDrift": {
        "type": "augmentation",
        "category": "spectral-baseline",
        "name": "PolynomialBaselineDrift",
        "description": "Polynomial baseline drift augmentation",
    },
    # Augmentation - spectral wavelength
    "nirs4all.operators.augmentation.spectral.WavelengthShift": {
        "type": "augmentation",
        "category": "spectral-wavelength",
        "name": "WavelengthShift",
        "description": "Random shift along wavelength axis",
    },
    "nirs4all.operators.augmentation.spectral.WavelengthStretch": {
        "type": "augmentation",
        "category": "spectral-wavelength",
        "name": "WavelengthStretch",
        "description": "Random stretch/compression of wavelength axis",
    },
    "nirs4all.operators.augmentation.spectral.LocalWavelengthWarp": {
        "type": "augmentation",
        "category": "spectral-wavelength",
        "name": "LocalWavelengthWarp",
        "description": "Local non-linear wavelength warping via control points",
    },
    "nirs4all.operators.augmentation.spectral.SmoothMagnitudeWarp": {
        "type": "augmentation",
        "category": "spectral-wavelength",
        "name": "SmoothMagnitudeWarp",
        "description": "Smooth magnitude warping via control points",
    },
    # Augmentation - spectral smoothing
    "nirs4all.operators.augmentation.spectral.GaussianSmoothingJitter": {
        "type": "augmentation",
        "category": "spectral-smoothing",
        "name": "GaussianSmoothingJitter",
        "description": "Random Gaussian smoothing with variable kernel width",
    },
    "nirs4all.operators.augmentation.spectral.UnsharpSpectralMask": {
        "type": "augmentation",
        "category": "spectral-smoothing",
        "name": "UnsharpSpectralMask",
        "description": "Unsharp masking for spectral sharpening",
    },
    # Augmentation - spectral masking
    "nirs4all.operators.augmentation.spectral.BandMasking": {
        "type": "augmentation",
        "category": "spectral-masking",
        "name": "BandMasking",
        "description": "Randomly mask spectral bands with interpolation or zeroing",
    },
    "nirs4all.operators.augmentation.spectral.ChannelDropout": {
        "type": "augmentation",
        "category": "spectral-masking",
        "name": "ChannelDropout",
        "description": "Random channel dropout with interpolation",
    },
    "nirs4all.operators.augmentation.spectral.BandPerturbation": {
        "type": "augmentation",
        "category": "spectral-masking",
        "name": "BandPerturbation",
        "description": "Random gain and offset perturbation of spectral bands",
    },
    "nirs4all.operators.augmentation.spectral.LocalClipping": {
        "type": "augmentation",
        "category": "spectral-masking",
        "name": "LocalClipping",
        "description": "Clip local spectral regions to flat values",
    },
    # Augmentation - spectral mixing
    "nirs4all.operators.augmentation.spectral.MixupAugmenter": {
        "type": "augmentation",
        "category": "spectral-mixing",
        "name": "MixupAugmenter",
        "description": "Mixup augmentation by blending sample pairs",
    },
    "nirs4all.operators.augmentation.spectral.LocalMixupAugmenter": {
        "type": "augmentation",
        "category": "spectral-mixing",
        "name": "LocalMixupAugmenter",
        "description": "Local mixup with k-nearest neighbors",
    },
    # Augmentation - spectral scatter simulation
    "nirs4all.operators.augmentation.spectral.ScatterSimulationMSC": {
        "type": "augmentation",
        "category": "spectral-scatter",
        "name": "ScatterSimulationMSC",
        "description": "Scatter simulation via MSC coefficient perturbation",
    },
    # Augmentation - environmental
    "nirs4all.operators.augmentation.environmental.TemperatureAugmenter": {
        "type": "augmentation",
        "category": "environmental-augmentation",
        "name": "TemperatureAugmenter",
        "description": "Temperature variation effects on NIR spectra",
    },
    "nirs4all.operators.augmentation.environmental.MoistureAugmenter": {
        "type": "augmentation",
        "category": "environmental-augmentation",
        "name": "MoistureAugmenter",
        "description": "Moisture content variation effects on NIR spectra",
    },
    # Augmentation - scattering
    "nirs4all.operators.augmentation.scattering.ParticleSizeAugmenter": {
        "type": "augmentation",
        "category": "scattering-augmentation",
        "name": "ParticleSizeAugmenter",
        "description": "Particle size scattering effects on NIR spectra",
    },
    "nirs4all.operators.augmentation.scattering.EMSCDistortionAugmenter": {
        "type": "augmentation",
        "category": "scattering-augmentation",
        "name": "EMSCDistortionAugmenter",
        "description": "EMSC-based scatter distortion augmentation",
    },
    # Augmentation - edge artifacts
    "nirs4all.operators.augmentation.edge_artifacts.DetectorRollOffAugmenter": {
        "type": "augmentation",
        "category": "edge-artifacts-augmentation",
        "name": "DetectorRollOffAugmenter",
        "description": "Detector roll-off edge effects simulation",
    },
    "nirs4all.operators.augmentation.edge_artifacts.StrayLightAugmenter": {
        "type": "augmentation",
        "category": "edge-artifacts-augmentation",
        "name": "StrayLightAugmenter",
        "description": "Stray light contamination at spectral edges",
    },
    "nirs4all.operators.augmentation.edge_artifacts.EdgeCurvatureAugmenter": {
        "type": "augmentation",
        "category": "edge-artifacts-augmentation",
        "name": "EdgeCurvatureAugmenter",
        "description": "Edge curvature distortion augmentation",
    },
    "nirs4all.operators.augmentation.edge_artifacts.TruncatedPeakAugmenter": {
        "type": "augmentation",
        "category": "edge-artifacts-augmentation",
        "name": "TruncatedPeakAugmenter",
        "description": "Truncated peak artifacts at spectral edges",
    },
    "nirs4all.operators.augmentation.edge_artifacts.EdgeArtifactsAugmenter": {
        "type": "augmentation",
        "category": "edge-artifacts-augmentation",
        "name": "EdgeArtifactsAugmenter",
        "description": "Combined edge artifacts augmentation",
    },
    # Augmentation - synthesis
    "nirs4all.operators.augmentation.synthesis.PathLengthAugmenter": {
        "type": "augmentation",
        "category": "synthesis-augmentation",
        "name": "PathLengthAugmenter",
        "description": "Multiplicative path length variation augmentation",
    },
    "nirs4all.operators.augmentation.synthesis.BatchEffectAugmenter": {
        "type": "augmentation",
        "category": "synthesis-augmentation",
        "name": "BatchEffectAugmenter",
        "description": "Wavelength-dependent batch effect augmentation",
    },
    "nirs4all.operators.augmentation.synthesis.InstrumentalBroadeningAugmenter": {
        "type": "augmentation",
        "category": "synthesis-augmentation",
        "name": "InstrumentalBroadeningAugmenter",
        "description": "Instrumental broadening via Gaussian convolution",
    },
    "nirs4all.operators.augmentation.synthesis.HeteroscedasticNoiseAugmenter": {
        "type": "augmentation",
        "category": "synthesis-augmentation",
        "name": "HeteroscedasticNoiseAugmenter",
        "description": "Signal-dependent heteroscedastic noise augmentation",
    },
    "nirs4all.operators.augmentation.synthesis.DeadBandAugmenter": {
        "type": "augmentation",
        "category": "synthesis-augmentation",
        "name": "DeadBandAugmenter",
        "description": "Dead band (non-responsive region) augmentation",
    },
    # nirs4all splitters
    "nirs4all.operators.splitters.splitters.KennardStoneSplitter": {
        "type": "splitting",
        "category": "nirs-splitters",
        "name": "KennardStoneSplitter",
        "description": "D-optimal Kennard-Stone sampling",
    },
    "nirs4all.operators.splitters.splitters.SPXYSplitter": {
        "type": "splitting",
        "category": "nirs-splitters",
        "name": "SPXYSplitter",
        "description": "SPXY sampling combining feature and target diversity",
    },
    "nirs4all.operators.splitters.splitters.KMeansSplitter": {
        "type": "splitting",
        "category": "nirs-splitters",
        "name": "KMeansSplitter",
        "description": "Clustering-based sampling with k-means",
    },
    "nirs4all.operators.splitters.splitters.SPlitSplitter": {
        "type": "splitting",
        "category": "nirs-splitters",
        "name": "SPlitSplitter",
        "description": "SPlit sampling based on twinning",
    },
    "nirs4all.operators.splitters.splitters.SystematicCircularSplitter": {
        "type": "splitting",
        "category": "nirs-splitters",
        "name": "SystematicCircularSplitter",
        "description": "Systematic circular sampling strategy",
    },
    "nirs4all.operators.splitters.splitters.KBinsStratifiedSplitter": {
        "type": "splitting",
        "category": "nirs-splitters",
        "name": "KBinsStratifiedSplitter",
        "description": "KBins stratified sampling in feature space",
    },
    # Target transforms
    "nirs4all.operators.transforms.targets.IntegerKBinsDiscretizer": {
        "type": "y_processing",
        "category": "target-transforms",
        "name": "IntegerKBinsDiscretizer",
        "description": "Discretize targets into integer KBins",
    },
    "nirs4all.operators.transforms.targets.RangeDiscretizer": {
        "type": "y_processing",
        "category": "target-transforms",
        "name": "RangeDiscretizer",
        "description": "Custom range-based discretization of targets",
    },
}


def safe_import_class(class_path: str):
    """Safely import a class from a module path."""
    try:
        module_name, class_name = class_path.rsplit(".", 1)
        import importlib

        module = importlib.import_module(module_name)
        return getattr(module, class_name, None)
    except Exception:
        return None


def generate_nirs4all_operators() -> list[dict[str, Any]]:
    """Generate nodes for nirs4all operators."""
    nodes: list[dict[str, Any]] = []

    for class_path, info in NIRS4ALL_OPERATORS.items():
        slug = snake_case(info["name"])
        node_type = info["type"]

        # Try to import and get params
        params: list[dict[str, Any]] = []
        cls = safe_import_class(class_path)
        if cls is not None:
            params = build_parameters(cls)

        nodes.append({
            "id": f"{node_type}.{slug}",
            "name": info["name"],
            "type": node_type,
            "description": info["description"],
            "parameters": params,
            "source": "nirs4all",
            "classPath": class_path,
            "category": info["category"],
            "tags": ["generated", "nirs4all", info["category"]],
            "isAdvanced": False,  # nirs4all operators are not advanced
        })

    return nodes


def generate_tensorflow_models(skip: bool = False) -> list[dict[str, Any]]:
    """Generate nodes for nirs4all TensorFlow models."""
    nodes: list[dict[str, Any]] = []

    if skip:
        print("[WARN] Skipping TensorFlow models (--skip-tensorflow)", file=sys.stderr)
        return nodes

    try:
        # TensorFlow import can be slow - using os.environ to disable verbose logging
        import os
        os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')

        import importlib

        # Import both modules - use importlib to ensure we get the actual module
        generic_mod = importlib.import_module("nirs4all.operators.models.tensorflow.generic")
        nicon_mod = importlib.import_module("nirs4all.operators.models.tensorflow.nicon")

        for module in (generic_mod, nicon_mod):
            for name, obj in inspect.getmembers(module, inspect.isfunction):
                # Skip internal functions and imported functions from other modules
                if name.startswith("_") or name in {"framework", "Input"}:
                    continue

                # Skip functions not defined in this module
                if hasattr(obj, "__module__") and obj.__module__ != module.__name__:
                    continue

                # Check framework attribute - decorator adds it directly to the function
                # The @framework decorator sets func.framework = framework_name
                fw = getattr(obj, "framework", None)
                if fw is None:
                    # Try __wrapped__ for decorated functions
                    wrapped = getattr(obj, "__wrapped__", None)
                    if wrapped:
                        fw = getattr(wrapped, "framework", None)

                if fw != "tensorflow":
                    continue

                slug = snake_case(name)
                func_path = f"{obj.__module__}.{name}"
                description = safe_first_line(obj.__doc__) or f"TensorFlow model {name}"

                # Extract params from function signature
                params: list[dict[str, Any]] = []
                try:
                    sig = inspect.signature(obj)
                    for pname, p in sig.parameters.items():
                        if pname in {"self", "cls"}:
                            continue
                        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
                            continue
                        has_default, default_value = jsonable_default(p.default)
                        param_type = infer_param_type(p.default if p.default is not inspect._empty else None)
                        entry: dict[str, Any] = {
                            "name": pname,
                            "type": param_type,
                            "isAdvanced": True,
                        }
                        if has_default:
                            entry["default"] = default_value
                        if p.default is inspect._empty:
                            entry["required"] = True
                        params.append(entry)
                except Exception:
                    pass

                nodes.append({
                    "id": f"model.tf_{slug}",
                    "name": name,
                    "type": "model",
                    "description": description,
                    "parameters": params,
                    "source": "nirs4all",
                    "functionPath": func_path,
                    "category": "tensorflow-models",
                    "tags": ["generated", "nirs4all", "tensorflow", "deep-learning"],
                    "isAdvanced": False,
                    "isDeepLearning": True,
                })
    except ImportError as e:
        print(f"[WARN] nirs4all TensorFlow models not available: {e}", file=sys.stderr)

    return nodes


# ============================================================================
# Main Generation
# ============================================================================


def generate_all_nodes(skip_tensorflow: bool = False) -> list[dict[str, Any]]:
    """Generate all extended registry nodes."""
    nodes: list[dict[str, Any]] = []

    # sklearn models FIRST - so they take precedence for dual-role classes like PLSRegression
    print("[INFO] Generating sklearn models...", file=sys.stderr)
    models = generate_sklearn_models()
    print(f"[INFO]   Generated {len(models)} models", file=sys.stderr)
    nodes.extend(models)

    # sklearn transformers SECOND - duplicates with models will be filtered by classPath
    print("[INFO] Generating sklearn transformers...", file=sys.stderr)
    transformers = generate_sklearn_transformers()
    print(f"[INFO]   Generated {len(transformers)} transformers", file=sys.stderr)
    nodes.extend(transformers)

    # sklearn splitters
    print("[INFO] Generating sklearn splitters...", file=sys.stderr)
    splitters = generate_sklearn_splitters()
    print(f"[INFO]   Generated {len(splitters)} splitters", file=sys.stderr)
    nodes.extend(splitters)

    # nirs4all operators
    print("[INFO] Generating nirs4all operators...", file=sys.stderr)
    nirs_ops = generate_nirs4all_operators()
    print(f"[INFO]   Generated {len(nirs_ops)} nirs4all operators", file=sys.stderr)
    nodes.extend(nirs_ops)

    # TensorFlow models (optional - can be slow to load)
    print("[INFO] Generating TensorFlow models...", file=sys.stderr)
    tf_models = generate_tensorflow_models(skip=skip_tensorflow)
    print(f"[INFO]   Generated {len(tf_models)} TensorFlow models", file=sys.stderr)
    nodes.extend(tf_models)

    # Sort deterministically by type priority then id
    # model > preprocessing > splitting > augmentation > other
    TYPE_PRIORITY = {"model": 0, "preprocessing": 1, "splitting": 2, "augmentation": 3}
    nodes.sort(key=lambda n: (TYPE_PRIORITY.get(n["type"], 99), n["id"]))

    # Dedupe by id AND classPath (keep first - which is model due to sorting)
    seen_ids: set[str] = set()
    seen_classpaths: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for n in nodes:
        if n["id"] in seen_ids:
            continue
        cp = n.get("classPath")
        if cp and cp in seen_classpaths:
            # Skip duplicate classPath (e.g., preprocessing.pls_regression when model.pls_regression exists)
            continue
        seen_ids.add(n["id"])
        if cp:
            seen_classpaths.add(cp)
        deduped.append(n)

    print(f"[INFO] Total unique nodes: {len(deduped)}", file=sys.stderr)
    return deduped


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate extended node registry JSON")
    parser.add_argument(
        "--out",
        default="public/node-registry/extended.json",
        help="Output JSON file path",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate output using scripts/validate-node-registry.cjs",
    )
    parser.add_argument(
        "--skip-tensorflow",
        action="store_true",
        help="Skip TensorFlow model generation (faster)",
    )

    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    out_path = (repo_root / args.out).resolve() if not Path(args.out).is_absolute() else Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    nodes = generate_all_nodes(skip_tensorflow=args.skip_tensorflow)

    out_path.write_text(
        json.dumps(nodes, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(nodes)} nodes to {out_path.relative_to(repo_root)}")

    # Sidecar metadata
    sklearn_version: str | None = None
    nirs4all_version: str | None = None
    try:
        import sklearn

        sklearn_version = getattr(sklearn, "__version__", None)
    except Exception:
        pass
    try:
        import nirs4all

        nirs4all_version = getattr(nirs4all, "__version__", None)
    except Exception:
        pass

    # Count by type
    type_counts: dict[str, int] = {}
    for n in nodes:
        t = n.get("type", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1

    # Count by source
    source_counts: dict[str, int] = {}
    for n in nodes:
        s = n.get("source", "unknown")
        source_counts[s] = source_counts.get(s, 0) + 1

    meta_path = out_path.with_name(out_path.stem + ".meta.json")
    meta = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "nodeCount": len(nodes),
        "pythonVersion": sys.version.split()[0],
        "sklearnVersion": sklearn_version,
        "nirs4allVersion": nirs4all_version,
        "generator": {
            "script": "scripts/generate_extended_registry.py",
            "format": "NodeDefinition[]",
        },
        "countsByType": type_counts,
        "countsBySource": source_counts,
    }
    meta_path.write_text(
        json.dumps(meta, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote metadata to {meta_path.relative_to(repo_root)}")

    if args.validate:
        validator = repo_root / "scripts" / "validate-node-registry.cjs"
        if validator.exists():
            cmd = ["node", str(validator), str(out_path)]
            print("Running:", " ".join(cmd))
            proc = subprocess.run(cmd, cwd=repo_root)
            if proc.returncode != 0:
                return proc.returncode
        else:
            print(f"[WARN] Validator not found: {validator}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
