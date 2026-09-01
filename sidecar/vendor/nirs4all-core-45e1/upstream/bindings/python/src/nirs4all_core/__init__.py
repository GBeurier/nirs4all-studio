"""Python surface for the nirs4all-core aggregate distribution."""

__version__ = "0.3.23"

from ._capabilities import (
    artifact_contracts,
    capability_manifest,
    controller_capabilities,
    required_keyword_registry_entries,
    runtime_contracts,
    runtime_surfaces,
)
from ._archive import (
    NativeArchiveUnavailableError,
    read_portable_predictor_package_v2,
    read_portable_refit_package_v3,
    replay_methods_archive_v2,
    replay_methods_archive_v2_conformal_presentation_v1,
    replay_methods_archive_v3,
    write_archive_v2_from_native_payloads,
    write_archive_v3_from_native_payloads,
)
from ._execution import PortableDataset, parse_execution_plan, run_portable_pipeline
from ._pipeline import (
    PORTABLE_OPERATOR_CLASSES,
    PipelineDefinition,
    load_pipeline_definition,
    portable_class_names,
)
from ._topology import (
    CORE_FACADE_EXPORTS,
    EXECUTION_ENGINE_EXPORTS,
    TOPOLOGY_EXPORTS,
    core_facade_exports,
    execution_engine_exports,
    release_topology_manifest,
    validate_core_facade,
)
from ._upstreams import (
    LazyUpstream,
    Upstream,
    available_upstreams,
    import_upstream,
    local_implementation_registry,
    require_upstream,
    upstream_status,
    upstreams,
)

dag_ml = LazyUpstream("dag_ml")
dag_ml_data = LazyUpstream("dag_ml_data")
datasets = LazyUpstream("datasets")
formats = LazyUpstream("formats")
io = LazyUpstream("io")
methods = LazyUpstream("methods")

__aggregate_import__ = __name__

__all__ = [
    "LazyUpstream",
    "NativeArchiveUnavailableError",
    "PORTABLE_OPERATOR_CLASSES",
    "PortableDataset",
    "PipelineDefinition",
    "CORE_FACADE_EXPORTS",
    "EXECUTION_ENGINE_EXPORTS",
    "TOPOLOGY_EXPORTS",
    "Upstream",
    "available_upstreams",
    "artifact_contracts",
    "capability_manifest",
    "core_facade_exports",
    "controller_capabilities",
    "dag_ml",
    "dag_ml_data",
    "datasets",
    "execution_engine_exports",
    "formats",
    "import_upstream",
    "io",
    "load_pipeline_definition",
    "local_implementation_registry",
    "methods",
    "parse_execution_plan",
    "portable_class_names",
    "release_topology_manifest",
    "read_portable_predictor_package_v2",
    "read_portable_refit_package_v3",
    "replay_methods_archive_v2",
    "replay_methods_archive_v2_conformal_presentation_v1",
    "replay_methods_archive_v3",
    "write_archive_v2_from_native_payloads",
    "write_archive_v3_from_native_payloads",
    "require_upstream",
    "required_keyword_registry_entries",
    "run_portable_pipeline",
    "runtime_contracts",
    "runtime_surfaces",
    "upstream_status",
    "upstreams",
    "validate_core_facade",
]
