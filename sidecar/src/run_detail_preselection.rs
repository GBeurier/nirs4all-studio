//! Fail-closed per-request route selection for linked-workspace run detail.

use std::path::Path;

use serde_json::{json, Value};

use crate::run_detail_cpython::preflight_run_detail_owner;
use crate::workspace_store::{
    preflight_run_detail_projection, WorkspaceStoreReadError, WORKSPACE_STORE_SCHEMA_VERSION,
};

pub const STUDIO_RUN_DETAIL_PRESELECTION_CONTRACT: &str =
    include_str!("../contracts/studio_run_detail_preselection_v1.json");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RunDetailTarget {
    NativeSidecar,
    ScientificPlugin,
    Reject,
}

#[derive(Debug)]
pub struct RunDetailPreselection {
    pub target: RunDetailTarget,
    pub verified_store_v5: bool,
    pub reason: &'static str,
    pub status: u16,
}

impl RunDetailPreselection {
    #[must_use]
    pub fn response(&self, workspace_id: &str) -> Value {
        json!({
            "schema_id": "nirs4all.studio-run-detail-preselection-decision.v1",
            "workspace_id": workspace_id,
            "target": match self.target {
                RunDetailTarget::NativeSidecar => "native-sidecar",
                RunDetailTarget::ScientificPlugin => "scientific-plugin",
                RunDetailTarget::Reject => "reject",
            },
            "verified_store_v5": self.verified_store_v5,
            "store_schema_version": if self.verified_store_v5 {
                Some(WORKSPACE_STORE_SCHEMA_VERSION)
            } else {
                None
            },
            "reason": self.reason,
            "fallback_after_native_selection": "none",
        })
    }
}

#[must_use]
pub fn preselect_run_detail(
    workspace_path: &Path,
    python_plugin_host: Option<&Path>,
) -> RunDetailPreselection {
    match preflight_run_detail_projection(workspace_path) {
        Ok(()) => match python_plugin_host {
            Some(host) if preflight_run_detail_owner(host).is_ok() => RunDetailPreselection {
                target: RunDetailTarget::NativeSidecar,
                verified_store_v5: true,
                reason: "store_v5_owner_materializer_ready",
                status: 200,
            },
            Some(_) => RunDetailPreselection {
                target: RunDetailTarget::Reject,
                verified_store_v5: true,
                reason: "studio_run_detail_owner_preflight_failed",
                status: 503,
            },
            None => RunDetailPreselection {
                target: RunDetailTarget::Reject,
                verified_store_v5: true,
                reason: "python_plugin_host_unconfigured",
                status: 503,
            },
        },
        Err(WorkspaceStoreReadError::StoreNotFound) => RunDetailPreselection {
            target: RunDetailTarget::ScientificPlugin,
            verified_store_v5: false,
            reason: "legacy_manifest_or_store_absent",
            status: 200,
        },
        Err(WorkspaceStoreReadError::SchemaVersion { .. }) => RunDetailPreselection {
            target: RunDetailTarget::ScientificPlugin,
            verified_store_v5: false,
            reason: "legacy_store_schema",
            status: 200,
        },
        Err(
            WorkspaceStoreReadError::LiveJournal(_) | WorkspaceStoreReadError::ChangedDuringRead,
        ) => RunDetailPreselection {
            target: RunDetailTarget::Reject,
            verified_store_v5: false,
            reason: "workspace_store_busy",
            status: 409,
        },
        Err(WorkspaceStoreReadError::MissingColumns { .. }) => RunDetailPreselection {
            target: RunDetailTarget::Reject,
            verified_store_v5: false,
            reason: "workspace_store_projection_incompatible",
            status: 409,
        },
        #[cfg(windows)]
        Err(WorkspaceStoreReadError::UnsupportedPath(_)) => RunDetailPreselection {
            target: RunDetailTarget::Reject,
            verified_store_v5: false,
            reason: "workspace_store_path_unsupported",
            status: 409,
        },
        Err(_) => RunDetailPreselection {
            target: RunDetailTarget::Reject,
            verified_store_v5: false,
            reason: "workspace_store_preselection_failed",
            status: 500,
        },
    }
}
