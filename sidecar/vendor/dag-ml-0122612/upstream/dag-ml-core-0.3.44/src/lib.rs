//! Core contracts for the DAG-ML control engine.
//!
//! This crate intentionally contains no host-runtime dependency and no heavy
//! data buffers. It validates control structures and leakage-sensitive
//! prediction flows that every binding must preserve.

pub mod aggregation;
pub mod archive_workspace;
pub mod bundle;
pub mod campaign;
pub mod canonical;
pub mod chain_effect;
pub mod conformal;
pub mod conformal_runtime;
pub mod controller;
pub mod controller_adapter;
pub mod controller_registry;
pub mod criteria;
pub mod data;
pub mod dsl;
pub mod error;
pub mod fold;
pub mod generation;
pub mod graph;
pub mod hpo;
pub mod ids;
pub mod implementation_registry;
pub mod initial_refit;
pub mod methods_classification;
mod methods_classification_archive;
mod methods_classification_state;
#[cfg(feature = "methods-optimizer")]
pub mod methods_estimator;
pub mod methods_fold_hpo;
pub mod methods_multimodal;
pub mod methods_phase_controls;
#[cfg(feature = "methods-optimizer")]
pub mod methods_role_pipeline;
pub mod metric_provider;
pub mod metrics;
pub mod n4m_roles;
pub mod nested_selection;
pub mod observability;
pub mod oof;
pub mod phase;
pub mod plan;
pub mod policy;
pub mod provenance;
mod python_torch_profile;
pub mod relation;
pub mod replay;
pub mod residual;
pub mod rng;
pub mod runtime;
pub mod selection;
pub mod source_alignment;
pub mod target_domain;
pub mod terminal_prediction;
pub mod training;
pub mod training_runtime;

pub use aggregation::*;
pub use archive_workspace::*;
pub use bundle::*;
pub use campaign::*;
pub use canonical::*;
pub use chain_effect::*;
pub use conformal::*;
pub use conformal_runtime::*;
pub use controller::*;
pub use controller_adapter::*;
pub use controller_registry::*;
pub use criteria::*;
pub use data::*;
pub use dsl::*;
pub use error::{
    DagMlError, DagMlErrorDescriptor, Result, TargetMissingRefusal, TargetMissingReport,
};
pub use fold::*;
pub use generation::*;
pub use graph::*;
pub use hpo::*;
pub use ids::*;
pub use implementation_registry::*;
pub use initial_refit::*;
#[cfg(feature = "methods-optimizer")]
pub use methods_estimator::*;
pub use metric_provider::*;
pub use metrics::*;
pub use n4m_roles::*;
pub use nested_selection::*;
pub use observability::*;
pub use oof::*;
pub use phase::*;
pub use plan::*;
pub use policy::*;
pub use provenance::*;
pub use relation::*;
pub use replay::*;
pub use residual::*;
pub use rng::*;
pub use runtime::*;
pub use selection::*;
pub use source_alignment::*;
pub use target_domain::*;
pub use terminal_prediction::*;
pub use training::*;
pub use training_runtime::*;

pub use methods_classification::*;
pub use methods_classification_archive::*;
pub use methods_fold_hpo::*;
pub use methods_multimodal::*;
pub use methods_phase_controls::*;
#[cfg(feature = "methods-optimizer")]
pub use methods_role_pipeline::*;

mod stable_json;

pub mod public_robustness;

pub mod multimodal_replay_inputs;
