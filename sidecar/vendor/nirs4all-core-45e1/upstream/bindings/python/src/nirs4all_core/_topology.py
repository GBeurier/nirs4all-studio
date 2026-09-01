"""Release topology and core facade contract for the aggregate package."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

CORE_FACADE_EXPORTS: tuple[str, ...] = (
    "LazyUpstream",
    "NativeArchiveUnavailableError",
    "PORTABLE_OPERATOR_CLASSES",
    "PipelineDefinition",
    "Upstream",
    "available_upstreams",
    "artifact_contracts",
    "capability_manifest",
    "controller_capabilities",
    "dag_ml",
    "dag_ml_data",
    "datasets",
    "formats",
    "import_upstream",
    "io",
    "load_pipeline_definition",
    "local_implementation_registry",
    "methods",
    "portable_class_names",
    "require_upstream",
    "read_portable_predictor_package_v2",
    "read_portable_refit_package_v3",
    "replay_methods_archive_v2",
    "replay_methods_archive_v2_conformal_presentation_v1",
    "replay_methods_archive_v3",
    "write_archive_v2_from_native_payloads",
    "write_archive_v3_from_native_payloads",
    "required_keyword_registry_entries",
    "runtime_contracts",
    "runtime_surfaces",
    "upstream_status",
    "upstreams",
)

EXECUTION_ENGINE_EXPORTS: tuple[str, ...] = (
    "PortableDataset",
    "parse_execution_plan",
    "run_portable_pipeline",
)

TOPOLOGY_EXPORTS: tuple[str, ...] = (
    "CORE_FACADE_EXPORTS",
    "EXECUTION_ENGINE_EXPORTS",
    "TOPOLOGY_EXPORTS",
    "core_facade_exports",
    "execution_engine_exports",
    "release_topology_manifest",
    "validate_core_facade",
)

_LICENSE_EXPRESSION = "CECILL-2.1 OR AGPL-3.0-or-later"

_NAMESPACE_FACADES: dict[str, Any] = {
    "python": [
        {
            "import": "nirs4all_core",
            "distribution": "nirs4all-core",
            "kind": "canonical",
            "exports": "full_aggregate",
            "execution_engine": True,
        },
        {
            "import": "n4a",
            "distribution": "nirs4all-core",
            "kind": "additive-brand-facade",
            "backing_import": "nirs4all_core",
            "exports": "full_aggregate",
            "execution_engine": True,
        },
    ],
    "reserved_python_imports": [
        {
            "import": "nirs4all",
            "reason": "owned by the full Python modelling library until cutover",
        }
    ],
    "non_python": [
        {
            "ecosystem": "rust",
            "distribution": "nirs4all",
            "namespace": "nirs4all",
        },
        {
            "ecosystem": "javascript_wasm",
            "distribution": "nirs4all",
            "namespace": "nirs4all",
        },
        {
            "ecosystem": "r",
            "distribution": "nirs4all",
            "namespace": "library(nirs4all)",
        },
        {
            "ecosystem": "matlab_octave",
            "distribution": "nirs4all",
            "namespace": "+nirs4all",
        },
    ],
}

_INSTALL_DISTRIBUTIONS: list[dict[str, Any]] = [
    {
        "ecosystem": "python",
        "registry": "pypi",
        "name": "nirs4all-core",
        "role": "current Python aggregate distribution",
        "status": "current",
        "artifact": "wheel+sdist",
        "workflow": "release-python.yml",
        "imports": ["nirs4all_core", "n4a"],
        "default_inclusion": "base",
    },
    {
        "ecosystem": "rust",
        "registry": "crates.io",
        "name": "nirs4all",
        "role": "Rust aggregate crate",
        "status": "current",
        "artifact": "crate",
        "workflow": "release-crates.yml",
        "imports": ["nirs4all"],
        "default_inclusion": "base",
    },
    {
        "ecosystem": "javascript_wasm",
        "registry": "npm",
        "name": "nirs4all",
        "role": "JavaScript/WASM aggregate package",
        "status": "current",
        "artifact": "npm package",
        "workflow": "release-npm.yml",
        "imports": ["nirs4all"],
        "default_inclusion": "base",
    },
    {
        "ecosystem": "r",
        "registry": "cran/r-universe",
        "name": "nirs4all",
        "role": "R aggregate package",
        "status": "current",
        "artifact": "source package",
        "workflow": "release-r.yml",
        "imports": ["library(nirs4all)"],
        "default_inclusion": "base",
    },
    {
        "ecosystem": "matlab_octave",
        "registry": "github-release",
        "name": "nirs4all-matlab-octave",
        "role": "MATLAB/Octave aggregate namespace archive",
        "status": "current",
        "artifact": "zip archive",
        "workflow": "release-matlab.yml",
        "imports": ["+nirs4all"],
        "default_inclusion": "base",
    },
    {
        "ecosystem": "source_sbom",
        "registry": "github-release",
        "name": "nirs4all-core-source-sbom",
        "role": "source archive, SBOM, checksums, and provenance",
        "status": "current",
        "artifact": "source archive + CycloneDX SBOM + SHA256SUMS",
        "workflow": "release-source.yml",
        "imports": [],
        "default_inclusion": "release-provenance",
    },
    {
        "ecosystem": "python",
        "registry": "pypi",
        "name": "nirs4all-methods",
        "role": "numerical methods execution engine",
        "status": "upstream-explicit",
        "component_key": "methods",
        "default_inclusion": "aggregate-extra",
        "python_extra": "methods",
    },
    {
        "ecosystem": "python",
        "registry": "pypi",
        "name": "nirs4all-formats",
        "role": "vendor file readers",
        "status": "upstream-explicit",
        "component_key": "formats",
        "default_inclusion": "aggregate-extra",
        "python_extra": "formats",
    },
    {
        "ecosystem": "python",
        "registry": "pypi",
        "name": "nirs4all-io",
        "role": "dataset assembly bridge",
        "status": "upstream-explicit",
        "component_key": "io",
        "default_inclusion": "aggregate-extra",
        "python_extra": "io",
    },
    {
        "ecosystem": "python",
        "registry": "pypi",
        "name": "nirs4all-datasets",
        "role": "optional dataset catalog",
        "status": "external-optional",
        "component_key": "datasets",
        "default_inclusion": "external",
        "python_extra": "datasets",
    },
    {
        "ecosystem": "python",
        "registry": "pypi",
        "name": "dag-ml",
        "role": "DAG/ML coordinator",
        "status": "upstream-explicit",
        "component_key": "dag_ml",
        "default_inclusion": "aggregate-extra",
        "python_extra": "dag-ml",
    },
    {
        "ecosystem": "python",
        "registry": "pypi",
        "name": "dag-ml-data",
        "role": "sample-aligned data contracts",
        "status": "upstream-explicit",
        "component_key": "dag_ml_data",
        "default_inclusion": "aggregate-extra",
        "python_extra": "dag-ml-data",
    },
]

_V1_RELEASE_SURFACES: list[dict[str, Any]] = [
    {
        "ecosystem": "python",
        "registry": "pypi",
        "distribution": "nirs4all-core",
        "namespace": "nirs4all_core",
        "package_manifest": "bindings/python/pyproject.toml",
        "version_source": "bindings/python/pyproject.toml:project.version",
        "version_spelling": "pep440",
        "release_workflow": "release-python.yml",
        "local_gate": "test-python",
        "tool_policy": "required",
    },
    {
        "ecosystem": "javascript_wasm",
        "registry": "npm",
        "distribution": "nirs4all",
        "namespace": "nirs4all",
        "package_manifest": "bindings/wasm/package.json",
        "version_source": "bindings/wasm/package.json:version",
        "version_spelling": "cargo-semver",
        "release_workflow": "release-npm.yml",
        "local_gate": "test-wasm",
        "tool_policy": "required",
    },
    {
        "ecosystem": "rust",
        "registry": "crates.io",
        "distribution": "nirs4all",
        "namespace": "nirs4all",
        "package_manifest": "bindings/rust/nirs4all/Cargo.toml",
        "version_source": "bindings/rust/nirs4all/Cargo.toml:package.version",
        "version_spelling": "cargo-semver",
        "version_source_of_truth": True,
        "release_workflow": "release-crates.yml",
        "local_gate": "test-rust",
        "tool_policy": "required",
    },
    {
        "ecosystem": "r",
        "registry": "cran/r-universe",
        "distribution": "nirs4all",
        "namespace": "library(nirs4all)",
        "package_manifest": "bindings/r/DESCRIPTION",
        "version_source": "bindings/r/DESCRIPTION:Version",
        "version_spelling": "r-description",
        "release_workflow": "release-r.yml",
        "local_gate": "test-r-if-available",
        "tool_policy": "skip-locally-if-r-missing",
    },
    {
        "ecosystem": "matlab_octave",
        "registry": "github-release",
        "distribution": "nirs4all-matlab-octave",
        "namespace": "+nirs4all",
        "package_manifest": "bindings/matlab/README.md",
        "version_source": "bindings/rust/nirs4all/Cargo.toml:package.version",
        "version_spelling": "derived-cargo-semver",
        "release_workflow": "release-matlab.yml",
        "local_gate": "test-matlab-parity-if-available",
        "tool_policy": "skip-locally-if-octave-missing",
    },
]

_UPSTREAM_COMPONENTS: list[dict[str, Any]] = [
    {
        "key": "dag_ml",
        "repo": "GBeurier/dag-ml",
        "role": "Leakage-safe DAG/ML execution coordinator",
        "owner_boundary": "control",
        "default_inclusion": "aggregate-extra",
        "optional": False,
        "private": False,
        "python": {
            "distribution": "dag-ml",
            "extra": "dag-ml",
            "imports": ["dag_ml"],
            "bundled_in_all": True,
        },
        "packages": {
            "rust": ["dag-ml"],
            "npm": ["dag-ml-wasm"],
            "r": ["dagml"],
            "matlab": ["+dagml"],
            "c_abi": [],
        },
    },
    {
        "key": "dag_ml_data",
        "repo": "GBeurier/dag-ml-data",
        "role": "Sample-aligned data contracts for DAG/ML runtimes",
        "owner_boundary": "data",
        "default_inclusion": "aggregate-extra",
        "optional": False,
        "private": False,
        "python": {
            "distribution": "dag-ml-data",
            "extra": "dag-ml-data",
            "imports": ["dag_ml_data"],
            "bundled_in_all": True,
        },
        "packages": {
            "rust": ["dag-ml-data"],
            "npm": ["dag-ml-data-wasm"],
            "r": ["dagmldata"],
            "matlab": [],
            "c_abi": [],
        },
    },
    {
        "key": "formats",
        "repo": "GBeurier/nirs4all-formats",
        "role": "Spectroscopy/NIRS vendor file readers",
        "owner_boundary": "readers",
        "default_inclusion": "aggregate-extra",
        "optional": False,
        "private": False,
        "python": {
            "distribution": "nirs4all-formats",
            "extra": "formats",
            "imports": ["nirs4all_formats", "nirs4all.formats"],
            "bundled_in_all": True,
        },
        "packages": {
            "rust": [],
            "npm": ["@nirs4all/formats-wasm"],
            "r": ["nirs4allformats"],
            "matlab": [],
            "c_abi": [],
        },
    },
    {
        "key": "io",
        "repo": "GBeurier/nirs4all-io",
        "role": "Dataset assembly bridge",
        "owner_boundary": "assembly",
        "default_inclusion": "aggregate-extra",
        "optional": False,
        "private": False,
        "python": {
            "distribution": "nirs4all-io",
            "extra": "io",
            "imports": ["nirs4all_io", "nirs4all.io"],
            "bundled_in_all": True,
        },
        "packages": {
            "rust": [],
            "npm": ["@nirs4all/io-wasm"],
            "r": ["nirs4allio"],
            "matlab": [],
            "c_abi": [],
        },
    },
    {
        "key": "datasets",
        "repo": "GBeurier/nirs4all-datasets",
        "role": "DOI-pinned NIRS dataset catalog",
        "owner_boundary": "catalog",
        "default_inclusion": "external",
        "optional": True,
        "private": False,
        "python": {
            "distribution": "nirs4all-datasets",
            "extra": "datasets",
            "imports": ["nirs4all_datasets", "nirs4all.datasets"],
            "bundled_in_all": False,
        },
        "packages": {
            "rust": [],
            "npm": ["@nirs4all/datasets-wasm"],
            "r": ["nirs4alldatasets"],
            "matlab": [],
            "c_abi": [],
        },
    },
    {
        "key": "methods",
        "repo": "GBeurier/nirs4all-methods",
        "role": "Portable C ABI PLS/NIRS numerical engine",
        "owner_boundary": "kernels",
        "default_inclusion": "aggregate-extra",
        "optional": False,
        "private": False,
        "python": {
            "distribution": "nirs4all-methods",
            "extra": "methods",
            "imports": [
                "nirs4all_methods",
                "pls4all",
                "n4m",
                "nirs4all.methods",
            ],
            "bundled_in_all": True,
        },
        "packages": {
            "rust": [],
            "npm": ["@nirs4all/methods"],
            "r": ["n4m", "pls4all"],
            "matlab": ["+n4m"],
            "c_abi": [
                {
                    "header": "cpp/include/n4m/n4m.h",
                    "symbol_prefix": "n4m_",
                }
            ],
        },
    },
]

_RELEASE_POINTERS: dict[str, Any] = {
    "license": {
        "expression": _LICENSE_EXPRESSION,
        "source": "bindings/python/pyproject.toml:project.license",
        "files": [
            "LICENSE",
            "bindings/python/LICENSE",
            "bindings/wasm/LICENSE",
            "bindings/r/LICENSE",
            "bindings/matlab/LICENSE",
            "LICENSING.md",
            "THIRD_PARTY_NOTICES.md",
        ],
    },
    "abi": [
        {
            "key": "methods_c_abi",
            "provider": "nirs4all-methods",
            "component_key": "methods",
            "header": "cpp/include/n4m/n4m.h",
            "symbol_prefix": "n4m_",
            "status": "upstream-owned",
            "consumers": [
                "python",
                "rust",
                "r",
                "matlab_octave",
                "javascript_wasm",
            ],
            "conformance_refs": ["n4m.abi", "n4m.parity_ledger"],
        }
    ],
    "provenance": {
        "workflow": "release-source.yml",
        "artifacts": ["CycloneDX SBOM", "SHA256SUMS", "source archive"],
    },
}

_RELEASE_TOPOLOGY_MANIFEST: dict[str, Any] = {
    "schema": "nirs4all-core.release-topology.v2",
    "aggregate": {
        "id": "nirs4all-core",
        "repo": "GBeurier/nirs4all-core",
        "target_repo": "GBeurier/nirs4all-core",
        "repo_rename_status": "completed",
        "owner_boundary": "aggregate",
        "default_inclusion": "base",
        "private": False,
    },
    "python": {
        "distribution": "nirs4all-core",
        "canonical_import": "nirs4all_core",
        "additive_imports": ["n4a"],
        "reserved_non_imports": ["nirs4all"],
    },
    "core_contract": {
        "import": "nirs4all_core",
        "backing_import": "nirs4all_core",
        "allowed_roles": ["inspect", "validate", "capability", "facade", "execute"],
        "execution_engine": True,
        "public_exports": list(
            CORE_FACADE_EXPORTS + EXECUTION_ENGINE_EXPORTS + TOPOLOGY_EXPORTS
        ),
        "core_exports": list(CORE_FACADE_EXPORTS),
        "topology_exports": list(TOPOLOGY_EXPORTS),
        "execution_exports": list(EXECUTION_ENGINE_EXPORTS),
    },
    "namespace_facades": _NAMESPACE_FACADES,
    "install_distributions": _INSTALL_DISTRIBUTIONS,
    "v1_release_surfaces": _V1_RELEASE_SURFACES,
    "upstream_components": _UPSTREAM_COMPONENTS,
    "release_pointers": _RELEASE_POINTERS,
}


def core_facade_exports() -> tuple[str, ...]:
    """Return the public exports in the release-gated core facade contract."""

    return CORE_FACADE_EXPORTS


def execution_engine_exports() -> tuple[str, ...]:
    """Return aggregate exports that are deliberately outside the core contract."""

    return EXECUTION_ENGINE_EXPORTS


def release_topology_manifest() -> dict[str, Any]:
    """Return a serializable manifest for package names and facade contracts."""

    return deepcopy(_RELEASE_TOPOLOGY_MANIFEST)


def validate_core_facade(module: Any) -> dict[str, tuple[str, ...]]:
    """Validate that a module advertises the complete core aggregate contract."""

    public_exports = set(getattr(module, "__all__", ()))
    required = set(CORE_FACADE_EXPORTS + EXECUTION_ENGINE_EXPORTS + TOPOLOGY_EXPORTS)
    return {
        "missing_public_exports": tuple(sorted(required - public_exports)),
        "missing_execution_exports": tuple(
            sorted(set(EXECUTION_ENGINE_EXPORTS) - public_exports)
        ),
    }
