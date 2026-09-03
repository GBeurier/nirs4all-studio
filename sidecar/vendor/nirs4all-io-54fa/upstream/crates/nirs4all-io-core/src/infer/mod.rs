// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Inference over neutral descriptions (ports the pure parts of `nirs4all_io.infer`).
//!
//! The pure scorers/detectors and the `DatasetPlan` live here; the facade
//! populates `FileDescription`/`TableProfile` from files and orchestrates the
//! `infer()` pipeline.

pub mod column_roles;
pub mod describe;
pub mod detectors;
pub mod identity;
pub mod memory;
pub mod plan;
pub mod propose;
pub mod table;

pub use describe::{describe_text, FileDescription};
pub use detectors::{detect_signal_type, detect_task_type};
pub use plan::{DatasetPlan, Decision};
pub use propose::{propose_browser_dataset, ConfirmedLock, Proposal, ProposalResult};
pub use table::{ColDtype, ColumnProfile, NumericKind, TableProfile};
