//! ADR-12 observability hooks.
//!
//! All `tracing` emission for the control core is centralized here so the set of
//! telemetry field names stays auditable in one place. Spans and events carry
//! **identifiers and counts only** — never feature matrices, targets, sample
//! values or metadata contents. This preserves, at the telemetry layer, the same
//! boundary the data ABI enforces: the core never exposes raw data.
//!
//! The CI lint `scripts/lint_tracing_fields.py` enforces two invariants:
//! 1. no `tracing` usage exists outside this module (so every event is vetted);
//! 2. no field name in this module matches the forbidden
//!    `data|features|targets|sample|metadata` pattern (singular `sample` also
//!    rejects `sample_count`, `sample_ids`, etc.).
//!
//! The core only emits through the `tracing` facade; it never installs a
//! subscriber. Binaries and hosts choose a sink (the CLI installs a
//! `tracing_subscriber::fmt` layer driven by `RUST_LOG`; see
//! `docs/OBSERVABILITY.md`).

use tracing::{info_span, warn, Span};

/// Frozen ADR-12 telemetry field allowlist. Every field emitted by this module
/// must appear here, and each entry is an identifier or a count — never data.
/// Adding a field requires an ADR-12 update and a review per the privacy rule.
pub const OBSERVABILITY_FIELD_ALLOWLIST: &[&str] = &[
    "run_id",
    "plan_id",
    "variant_id",
    "fold_id",
    "controller_id",
    "phase",
    "node_id",
    "partition_id",
    "cache_hit",
    "oof_refused",
    "category",
    "code",
    "violator_count",
];

/// Build the per-phase-scope span (ADR-12). `run_id`/`plan_id` correlate
/// concurrent or overlapping runs; empty `variant_id`/`fold_id` mean the field is
/// not applicable to the current phase. Fields are identifiers only.
pub fn phase_span(
    run_id: &str,
    plan_id: &str,
    phase: &str,
    variant_id: Option<&str>,
    fold_id: Option<&str>,
) -> Span {
    info_span!(
        "dag_ml.phase",
        run_id = run_id,
        plan_id = plan_id,
        phase = phase,
        variant_id = variant_id.unwrap_or_default(),
        fold_id = fold_id.unwrap_or_default(),
    )
}

/// Build the per-node span (ADR-12), nested under the current phase span so node
/// telemetry is attributed to its run, plan and controller. Identifiers only.
pub fn node_span(
    run_id: &str,
    plan_id: &str,
    phase: &str,
    node_id: &str,
    controller_id: &str,
) -> Span {
    info_span!(
        "dag_ml.node",
        run_id = run_id,
        plan_id = plan_id,
        phase = phase,
        node_id = node_id,
        controller_id = controller_id,
    )
}

/// Emit the ADR-12 out-of-fold leakage refusal event with stable taxonomy fields
/// (`category`/`code` mirror [`crate::DagMlError::OofLeakage`]) so log consumers
/// can alert on refusals without parsing messages.
pub fn emit_oof_refusal(node_id: &str, violator_count: usize) {
    warn!(
        oof_refused = true,
        category = "validation",
        code = "oof_leakage",
        node_id = node_id,
        violator_count = violator_count,
        "out-of-fold leakage refused"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_contains_no_data_bearing_field() {
        for field in OBSERVABILITY_FIELD_ALLOWLIST {
            for forbidden in ["data", "features", "targets", "sample", "metadata"] {
                assert!(
                    !field.contains(forbidden),
                    "allowlisted field `{field}` leaks `{forbidden}`"
                );
            }
        }
    }

    #[test]
    fn helpers_emit_without_subscriber() {
        // No subscriber is installed in tests; the facade calls must be no-ops
        // rather than panic.
        let span = phase_span(
            "run:1",
            "plan:1",
            "FIT_CV",
            Some("variant:0"),
            Some("fold:0"),
        );
        let _entered = span.entered();
        let _node = node_span("run:1", "plan:1", "FIT_CV", "node:model", "controller:m").entered();
        emit_oof_refusal("node:model", 2);
    }
}
