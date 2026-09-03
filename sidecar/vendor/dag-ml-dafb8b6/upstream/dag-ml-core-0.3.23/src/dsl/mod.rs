//! Pipeline DSL: parse, validate, and compile the declarative pipeline spec
//! into a [`GraphSpec`] / [`CompiledPipelineDsl`].
//!
//! Split from the former monolithic `dsl.rs` into cohesive submodules (pure
//! refactor — code moved verbatim). `mod.rs` owns the shared imports and
//! re-exports the full DSL surface so `pub use dsl::*` in `lib.rs` resolves
//! identically. Submodules pull every shared name in through `use super::*`.

pub(crate) use std::collections::{BTreeMap, BTreeSet};

pub(crate) use serde::{de::DeserializeOwned, Deserialize, Serialize};

pub(crate) use crate::controller::ControllerRegistry;
pub(crate) use crate::data::{BranchViewMode, BranchViewPlan, DataBinding, DataViewSelector};
pub(crate) use crate::error::{DagMlError, Result};
pub(crate) use crate::fold::NestedCvSpec;
pub(crate) use crate::generation::{
    constraints_satisfied, generation_spec_fingerprint, ChoiceRef, GenerationChoice,
    GenerationConstraints, GenerationDimension, GenerationParamOverride, GenerationSpec,
    GenerationStrategy, OperatorVariantModel,
};
pub(crate) use crate::graph::{
    EdgeContract, EdgeSpec, GraphInterface, GraphSpec, NodeKind, NodeSpec, PortCardinality,
    PortKind, PortRef, PortSchema, PortSpec,
};
pub(crate) use crate::ids::NodeId;
pub(crate) use crate::plan::{CampaignSpec, SplitInvocation};
pub(crate) use crate::policy::{
    AggregationPolicy, AugmentationPolicy, DataModelShapePlan, FeatureSelectionPolicy, FitBoundary,
    Granularity, LeakageUnitPolicy,
};
pub(crate) use crate::relation::EntityUnitLevel;

mod alias;
mod compat;
mod compat_helpers;
mod compiler;
mod fanout;
mod generation;
mod types;

// `types`, `compiler`, and `fanout` carry the public DSL surface (the
// `PipelineDsl*` types, the `compile_*`/`parse_*`/`lower_*`/`resolve_*` entry
// points, `fan_out_data_aware_branches`, and the schema/metadata constants) and
// are re-exported publicly so `pub use dsl::*` in `lib.rs` resolves identically.
pub use compiler::*;
pub use fanout::*;
pub use types::*;

// The operator-variant content-fingerprint contract (Phase 5) is part of the PUBLIC surface so the
// dag-ml-py binding can expose the SAME canonicalization to the nirs4all host (one codepath, two
// callers — host label byte-identical to the report label by construction).
pub use generation::{
    operator_variant_canonical_value, operator_variant_label,
    operator_variant_label_from_steps_json,
};

// `alias`, `compat`, `compat_helpers`, and `generation` hold only crate-internal
// helpers; re-export them crate-wide so sibling submodules resolve them through
// `use super::*` without widening the public surface.
pub(crate) use alias::*;
pub(crate) use compat::*;
pub(crate) use compat_helpers::*;
pub(crate) use generation::*;

#[cfg(test)]
mod tests;
