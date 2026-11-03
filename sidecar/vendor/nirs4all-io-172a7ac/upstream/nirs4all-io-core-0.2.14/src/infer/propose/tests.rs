// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Tests for the iterative proposal/validation engine.

use super::*;
use crate::infer::memory::infer_browser_dataset;
use crate::materialize::{assemble_in_memory, AssembledDataset, InMemorySource, SourcePayload};
use crate::spec::DatasetSpec;
use std::collections::HashMap;

fn mem_sources(files: &[NamedBytes]) -> Vec<InMemorySource> {
    files
        .iter()
        .map(|f| InMemorySource {
            name: f.name.clone(),
            payload: SourcePayload::Bytes(f.bytes.clone()),
        })
        .collect()
}

fn assemble(spec: &DatasetSpec, files: &[NamedBytes]) -> AssembledDataset {
    assemble_in_memory(spec, &mem_sources(files), &HashMap::new(), None).expect("spec materializes")
}

fn named(name: &str, text: &str) -> NamedBytes {
    NamedBytes {
        name: name.into(),
        bytes: text.as_bytes().to_vec(),
    }
}

fn lock(kind: &str, target: &str, value: Value) -> ConfirmedLock {
    ConfirmedLock {
        kind: kind.into(),
        target: target.into(),
        value,
        status: None,
    }
}

fn of_kind<'a>(r: &'a ProposalResult, kind: &str) -> Vec<&'a Proposal> {
    r.proposals
        .iter()
        .filter(|p| p.kind.as_str() == kind)
        .collect()
}

fn source_id_for(r: &ProposalResult, input: &str) -> String {
    r.spec.to_value()["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["input"] == json!(input))
        .expect("source for input")["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn provisional_sources_created_for_unmatched_files() {
    // Two files matching no convention -> plain inference yields `sources: []`;
    // the proposal layer must synthesise one source per file (Codex #2).
    let files = vec![
        named("alpha.csv", "sample_id;1000;1005\ns1;0.1;0.2\ns2;0.2;0.3\n"),
        named("beta.csv", "1000;1005\n0.1;0.2\n0.2;0.3\n"),
    ];
    let plain = infer_browser_dataset(&files, &[], None).unwrap();
    let plain_sources = plain.resolved_spec.unwrap().to_value()["sources"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(plain_sources, 0, "plain inference drops unmatched files");

    let r = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let inputs: Vec<String> = r.spec.to_value()["sources"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|s| s["input"].as_str().map(str::to_string))
        .collect();
    assert_eq!(inputs.len(), 2, "one provisional source per file");
    assert!(inputs.contains(&"alpha.csv".to_string()));
    assert!(inputs.contains(&"beta.csv".to_string()));
}

#[test]
fn equal_count_join_pairing_when_shared_unique_id() {
    let files = vec![
        named(
            "Xcal.csv",
            "sample_id;1000;1005\ns1;0.1;0.2\ns2;0.2;0.3\ns3;0.3;0.4\n",
        ),
        named("Ycal.csv", "sample_id;protein\ns1;11.0\ns2;12.0\ns3;13.0\n"),
    ];
    let r = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let pairing = of_kind(&r, "pairing");
    assert!(!pairing.is_empty(), "a pairing decision is proposed");
    let p = pairing[0];
    assert_eq!(p.value["mode"], json!("join_id"));
    assert_eq!(p.value["on"], json!("sample_id"));
}

#[test]
fn equal_count_row_order_low_score_when_no_shared_id() {
    // Convention names drive the roles; neither file carries an id column.
    let files = vec![
        named("Xcal.csv", "1000;1005\n0.1;0.2\n0.2;0.3\n0.3;0.4\n"),
        named("Ycal.csv", "protein\n11.0\n12.0\n13.0\n"),
    ];
    let r = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let p = of_kind(&r, "pairing");
    assert!(!p.is_empty(), "row-count pairing is proposed");
    let row = p
        .iter()
        .find(|p| p.value["mode"] == json!("row_order"))
        .expect("row_order mode");
    assert!(row.ambiguous, "row-count-only pairing is ambiguous");
    assert!(
        row.score < 0.6,
        "weak evidence => low score, got {}",
        row.score
    );
}

#[test]
fn confirmed_pairing_join_sets_source_join_and_suppresses_proposal() {
    let files = vec![
        named(
            "Xcal.csv",
            "sample_id;1000;1005\ns1;0.1;0.2\ns2;0.2;0.3\ns3;0.3;0.4\n",
        ),
        named("Ycal.csv", "sample_id;protein\ns1;11.0\ns2;12.0\ns3;13.0\n"),
    ];
    let r0 = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let target = of_kind(&r0, "pairing")[0].target.clone();

    let r = propose_browser_dataset(
        &files,
        &[],
        &[lock(
            "pairing",
            &target,
            json!({"mode": "join_id", "on": "sample_id"}),
        )],
        None,
    )
    .unwrap();

    let spec = r.spec.to_value();
    let has_join = spec["sources"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s.get("join").is_some());
    assert!(has_join, "join_id lock writes a SourceSpec.join");

    let open = r
        .proposals
        .iter()
        .filter(|p| {
            p.kind == ProposalKind::Pairing
                && p.target == target
                && p.status == ProposalStatus::Proposed
        })
        .count();
    assert_eq!(open, 0, "the confirmed pairing proposal is suppressed");
}

#[test]
fn confirmed_role_overrides_inferred_role() {
    let files = vec![named("alpha.csv", "1000;1005\n0.1;0.2\n0.2;0.3\n")];
    let r0 = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let id = source_id_for(&r0, "alpha.csv");

    let r = propose_browser_dataset(&files, &[], &[lock("role", &id, json!("metadata"))], None)
        .unwrap();
    let spec = r.spec.to_value();
    let src = &spec["sources"][0];
    assert_eq!(src["role"], json!("metadata"));
    let open_role = of_kind(&r, "role")
        .iter()
        .filter(|p| p.target == id && p.status == ProposalStatus::Proposed)
        .count();
    assert_eq!(open_role, 0, "role proposal suppressed once confirmed");
}

#[test]
fn confirmed_identity_sets_sample_index() {
    let files = vec![named(
        "alpha.csv",
        "sample_id;1000;1005\ns1;0.1;0.2\ns2;0.2;0.3\n",
    )];
    let r = propose_browser_dataset(
        &files,
        &[],
        &[lock(
            "identity",
            "dataset",
            json!({"by": "id", "key": "sample_id"}),
        )],
        None,
    )
    .unwrap();
    let spec = r.spec.to_value();
    assert_eq!(spec["sample_index"]["by"], json!("id"));
    assert_eq!(spec["sample_index"]["key"], json!("sample_id"));
}

#[test]
fn confirmed_signal_and_task_override_detectors() {
    let files = vec![named(
        "Xcal.csv",
        "sample_id;1000;1005\ns1;0.1;0.2\ns2;0.2;0.3\n",
    )];
    let r = propose_browser_dataset(
        &files,
        &[],
        &[
            lock("signal_type", "dataset", json!("absorbance")),
            lock("task_type", "dataset", json!("regression")),
        ],
        None,
    )
    .unwrap();
    let spec = r.spec.to_value();
    assert_eq!(spec["params"]["signal_type"], json!("absorbance"));
    assert_eq!(spec["task_type"], json!("regression"));
}

#[test]
fn no_locks_equals_plain_browser_inference() {
    // Convention-named files create their own sources, so no provisional source
    // is added and the proposal layer is a pure superset (spec unchanged).
    let files = vec![
        named(
            "Xcal.csv",
            "sample_id;1000;1005\ns1;0.1;0.2\ns2;0.2;0.3\ns3;0.3;0.4\n",
        ),
        named("Ycal.csv", "sample_id;protein\ns1;11.0\ns2;12.0\ns3;13.0\n"),
    ];
    let proposed = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let plain = infer_browser_dataset(&files, &[], None).unwrap();
    assert_eq!(
        proposed.spec.to_value(),
        plain.resolved_spec.unwrap().to_value()
    );
}

#[test]
fn invalid_lock_surfaces_validation_error() {
    // Re-role the only feature source to metadata -> the spec has no features.
    let files = vec![named("alpha.csv", "1000;1005\n0.1;0.2\n0.2;0.3\n")];
    let r0 = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let id = source_id_for(&r0, "alpha.csv");
    let r = propose_browser_dataset(&files, &[], &[lock("role", &id, json!("metadata"))], None)
        .unwrap();
    assert!(!r.valid, "validation runs and flags the invalid spec");
    assert!(!r.validation_errors.is_empty());
}

#[test]
fn sum_pairing_proposes_concat_samples() {
    let files = vec![
        named("part_a.csv", "1000;1005\n0.1;0.2\n0.2;0.3\n"),
        named("part_b.csv", "1000;1005\n0.3;0.4\n"),
        named("whole_y.csv", "protein\n11\n12\n13\n"),
    ];
    let r0 = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let whole = source_id_for(&r0, "whole_y.csv");
    // Only once the whole is a target does summing X parts make sense.
    let r = propose_browser_dataset(&files, &[], &[lock("role", &whole, json!("targets"))], None)
        .unwrap();
    let sum = of_kind(&r, "pairing")
        .into_iter()
        .find(|p| p.value["mode"] == json!("concat_samples"));
    assert!(
        sum.is_some(),
        "feature sources summing to the target are paired"
    );
    let parts = sum.unwrap().value["parts"].as_array().unwrap();
    assert_eq!(parts.len(), 2, "two feature parts stack into one X");
}

// --- materialization proofs: each lock yields a spec the assembler accepts --- //

#[test]
fn join_id_lock_materializes_y() {
    let files = vec![
        named(
            "Xcal.csv",
            "sample_id;1000;1005\ns1;0.1;0.2\ns2;0.2;0.3\ns3;0.3;0.4\n",
        ),
        named("Ycal.csv", "sample_id;protein\ns1;11.0\ns2;12.0\ns3;13.0\n"),
    ];
    let r0 = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let target = of_kind(&r0, "pairing")[0].target.clone();
    let r = propose_browser_dataset(
        &files,
        &[],
        &[lock(
            "pairing",
            &target,
            json!({"mode": "join_id", "on": "sample_id"}),
        )],
        None,
    )
    .unwrap();
    let a = assemble(&r.spec, &files);
    let block = a.blocks.get("train").expect("train block");
    assert_eq!(block.n_samples, 3);
    assert!(block.y.is_some(), "join_id lock materializes y");
}

#[test]
fn row_order_lock_materializes_y() {
    let files = vec![
        named("Xcal.csv", "1000;1005\n0.1;0.2\n0.2;0.3\n0.3;0.4\n"),
        named("Ycal.csv", "protein\n11.0\n12.0\n13.0\n"),
    ];
    let r0 = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let target = of_kind(&r0, "pairing")[0].target.clone();
    let r = propose_browser_dataset(
        &files,
        &[],
        &[lock("pairing", &target, json!({"mode": "row_order"}))],
        None,
    )
    .unwrap();
    let a = assemble(&r.spec, &files);
    let block = a.blocks.get("train").expect("train block");
    assert_eq!(block.n_samples, 3);
    assert!(block.y.is_some(), "row_order lock materializes y");
}

#[test]
fn concat_samples_lock_materializes_full_x_and_y() {
    let files = vec![
        named("part_a.csv", "1000;1005\n0.1;0.2\n0.2;0.3\n"),
        named("part_b.csv", "1000;1005\n0.3;0.4\n"),
        named("whole_y.csv", "protein\n11\n12\n13\n"),
    ];
    let r0 = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let a_id = source_id_for(&r0, "part_a.csv");
    let b_id = source_id_for(&r0, "part_b.csv");
    let y_id = source_id_for(&r0, "whole_y.csv");
    let r = propose_browser_dataset(
        &files,
        &[],
        &[
            lock("role", &y_id, json!("targets")),
            lock(
                "pairing",
                "sum",
                json!({"mode": "concat_samples", "parts": [a_id, b_id], "whole": y_id}),
            ),
        ],
        None,
    )
    .unwrap();
    // The two feature files folded into one multi-input concat source; y remains.
    let sources = r.spec.to_value()["sources"].as_array().unwrap().clone();
    assert_eq!(sources.len(), 2, "part_b folded into part_a; y remains");
    let a = assemble(&r.spec, &files);
    let block = a.blocks.get("train").expect("train block");
    assert_eq!(block.n_samples, 3, "2 + 1 stacked rows align with y(3)");
    assert!(block.y.is_some(), "concat_samples lock materializes y");
}

#[test]
fn concat_samples_keeps_shared_id_out_of_features() {
    // Both X parts carry `sample_id`; folding must preserve the key so the id
    // stays out of X (else it would be coerced to a NaN feature column).
    let files = vec![
        named(
            "part_a.csv",
            "sample_id;1000;1005\ns1;0.1;0.2\ns2;0.2;0.3\n",
        ),
        named(
            "part_b.csv",
            "sample_id;1000;1005\ns3;0.3;0.4\ns4;0.4;0.5\n",
        ),
        named("whole_y.csv", "protein\n11\n12\n13\n14\n"),
    ];
    let r0 = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let a_id = source_id_for(&r0, "part_a.csv");
    let b_id = source_id_for(&r0, "part_b.csv");
    let y_id = source_id_for(&r0, "whole_y.csv");
    let r = propose_browser_dataset(
        &files,
        &[],
        &[
            lock("role", &y_id, json!("targets")),
            lock(
                "pairing",
                "sum",
                json!({"mode": "concat_samples", "parts": [a_id, b_id], "whole": y_id}),
            ),
        ],
        None,
    )
    .unwrap();
    let a = assemble(&r.spec, &files);
    let block = a.blocks.get("train").expect("train block");
    assert_eq!(block.n_samples, 4, "2 + 2 stacked rows align with y(4)");
    let headers: Vec<String> = block.feature_headers.iter().flatten().cloned().collect();
    assert!(
        !headers.contains(&"sample_id".to_string()),
        "the shared id stays out of X, got {headers:?}"
    );
    assert!(block.y.is_some());
}

#[test]
fn proposal_ids_are_stable_across_reinference() {
    let files = vec![
        named("alpha.csv", "sample_id;1000;1005\ns1;0.1;0.2\ns2;0.2;0.3\n"),
        named("beta.csv", "sample_id;protein\ns1;11.0\ns2;12.0\n"),
    ];
    let a = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let b = propose_browser_dataset(&files, &[], &[], None).unwrap();
    let ids_a: Vec<&str> = a.proposals.iter().map(|p| p.id.as_str()).collect();
    let ids_b: Vec<&str> = b.proposals.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids_a, ids_b);
}
