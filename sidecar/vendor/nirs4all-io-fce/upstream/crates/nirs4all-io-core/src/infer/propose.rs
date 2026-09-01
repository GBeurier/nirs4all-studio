// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Iterative, user-validatable dataset proposals (EPIC: browser builder).
//!
//! This is a *post-processor* over the fs-free browser inference
//! ([`infer_browser_dataset`]). It never re-implements role / identity /
//! signal / task detection; it:
//!   1. runs the existing browser inference unchanged,
//!   2. synthesises a *provisional* source per un-sourced tabular file so the
//!      "add arbitrary files one at a time" flow has something to attach roles
//!      and pairings to (plain `infer_named_bytes` drops unmatched multi-file
//!      inputs to `sources: []`),
//!   3. applies the user's `confirmed` decisions (*locks*) to the working spec,
//!      rewriting the spec fields the assembler actually reads
//!      (`SourceSpec.join` / `SourceSpec.key` / `partition` / `sample_index` /
//!      `task_type` / `params.signal_type`),
//!   4. emits the still-open decisions as confirmable [`Proposal`]s — including
//!      the new pairing-by-row-count heuristic — each with alternatives,
//!      evidence and a (`py_round`-ed) score,
//!   5. returns the merged [`DatasetSpec`] plus a non-fatal validation report.
//!
//! Nothing here mutates the behaviour of `infer_named_bytes` /
//! `infer_browser_dataset` / the shared detectors / `Decision::to_value`, so the
//! facade byte-goldens and the in-memory-assembly golden stay green.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use crate::infer::column_roles::infer_column_roles;
use crate::infer::identity::detect_sample_id;
use crate::infer::memory::{
    describe_bytes, file_stem, infer_browser_dataset, infer_partition_from_name, params_from,
    read_table_bytes, source_first_input, unique_source_id, DecodedRecordSet, NamedBytes,
};
use crate::infer::plan::{DatasetPlan, Decision};
use crate::pyfmt::py_round;
use crate::spec::dataset_spec::LoadingParams;
use crate::spec::{validate_spec, DatasetSpec, SpecError};

const LEAF_ROLES: [&str; 4] = ["features", "targets", "metadata", "weights"];
const SIGNAL_TYPES: [&str; 6] = [
    "absorbance",
    "reflectance",
    "reflectance%",
    "transmittance",
    "transmittance%",
    "kubelka-munk",
];
const TASK_TYPES: [&str; 3] = ["regression", "binary", "multiclass"];

// --------------------------------------------------------------------------- //
// Data model                                                                  //
// --------------------------------------------------------------------------- //

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalKind {
    Structure,
    Role,
    Partition,
    Pairing,
    Identity,
    SignalType,
    TaskType,
    Folds,
}

impl ProposalKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ProposalKind::Structure => "structure",
            ProposalKind::Role => "role",
            ProposalKind::Partition => "partition",
            ProposalKind::Pairing => "pairing",
            ProposalKind::Identity => "identity",
            ProposalKind::SignalType => "signal_type",
            ProposalKind::TaskType => "task_type",
            ProposalKind::Folds => "folds",
        }
    }

    /// Stable pipeline order used to sort the proposals deterministically.
    fn order(self) -> u8 {
        match self {
            ProposalKind::Structure => 0,
            ProposalKind::Role => 1,
            ProposalKind::Partition => 2,
            ProposalKind::Pairing => 3,
            ProposalKind::Identity => 4,
            ProposalKind::SignalType => 5,
            ProposalKind::TaskType => 6,
            ProposalKind::Folds => 7,
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "structure" => ProposalKind::Structure,
            "role" => ProposalKind::Role,
            "partition" => ProposalKind::Partition,
            "pairing" => ProposalKind::Pairing,
            "identity" => ProposalKind::Identity,
            "signal_type" => ProposalKind::SignalType,
            "task_type" => ProposalKind::TaskType,
            "folds" => ProposalKind::Folds,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalStatus {
    Proposed,
    Confirmed,
    Overridden,
}

impl ProposalStatus {
    fn as_str(self) -> &'static str {
        match self {
            ProposalStatus::Proposed => "proposed",
            ProposalStatus::Confirmed => "confirmed",
            ProposalStatus::Overridden => "overridden",
        }
    }

    fn from_lock(status: Option<&str>) -> Self {
        match status {
            Some("overridden") => ProposalStatus::Overridden,
            _ => ProposalStatus::Confirmed,
        }
    }
}

/// An alternative value the user could pick instead of the proposed one.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub value: Value,
    pub score: f64,
    pub evidence: Vec<String>,
}

impl Candidate {
    fn new(value: Value, score: f64, evidence: Vec<String>) -> Self {
        Self {
            value,
            score,
            evidence,
        }
    }

    fn to_value(&self) -> Value {
        json!({
            "value": self.value,
            "score": py_round(self.score, 3),
            "evidence": self.evidence,
        })
    }
}

/// A single confirmable decision surfaced to the UI.
#[derive(Debug, Clone)]
pub struct Proposal {
    pub id: String,
    pub kind: ProposalKind,
    pub target: String,
    pub value: Value,
    pub score: f64,
    pub evidence: Vec<String>,
    pub alternatives: Vec<Candidate>,
    pub ambiguous: bool,
    pub status: ProposalStatus,
}

impl Proposal {
    fn open(
        kind: ProposalKind,
        target: impl Into<String>,
        value: Value,
        score: f64,
        evidence: Vec<String>,
    ) -> Self {
        let target = target.into();
        Self {
            id: format!("{}:{}", kind.as_str(), target),
            kind,
            target,
            value,
            score,
            evidence,
            alternatives: vec![],
            ambiguous: false,
            status: ProposalStatus::Proposed,
        }
    }

    fn with_alternatives(mut self, alternatives: Vec<Candidate>) -> Self {
        self.alternatives = alternatives;
        self
    }

    fn with_ambiguous(mut self, ambiguous: bool) -> Self {
        self.ambiguous = ambiguous;
        self
    }

    fn to_value(&self) -> Value {
        json!({
            "id": self.id,
            "kind": self.kind.as_str(),
            "target": self.target,
            "value": self.value,
            "score": py_round(self.score, 3),
            "evidence": self.evidence,
            "alternatives": self.alternatives.iter().map(Candidate::to_value).collect::<Vec<_>>(),
            "ambiguous": self.ambiguous,
            "status": self.status.as_str(),
        })
    }
}

/// A decision the user has accepted or overridden; fed back to constrain the
/// next inference. The realised analog of the dormant Python `infer(hints=...)`.
#[derive(Debug, Clone)]
pub struct ConfirmedLock {
    pub kind: String,
    pub target: String,
    pub value: Value,
    pub status: Option<String>,
}

/// The output of [`propose_browser_dataset`].
#[derive(Debug, Clone)]
pub struct ProposalResult {
    pub plan: DatasetPlan,
    pub proposals: Vec<Proposal>,
    pub spec: DatasetSpec,
    pub valid: bool,
    pub validation_errors: Vec<String>,
}

impl ProposalResult {
    pub fn to_value(&self) -> Value {
        json!({
            "plan": self.plan.to_value(),
            "proposals": self.proposals.iter().map(Proposal::to_value).collect::<Vec<_>>(),
            "spec": self.spec.to_value(),
            "valid": self.valid,
            "validation_errors": self.validation_errors,
        })
    }
}

// --------------------------------------------------------------------------- //
// Per-source facts (the unit the pairing heuristic reasons over)              //
// --------------------------------------------------------------------------- //

#[derive(Debug, Clone)]
struct SourceFacts {
    id: String,
    role: String,
    partition: Option<String>,
    n_rows: Option<usize>,
    /// Column names that are unique in this source (candidate join keys).
    unique_ids: BTreeSet<String>,
}

impl SourceFacts {
    fn is_feature_like(&self) -> bool {
        matches!(self.role.as_str(), "features" | "mixed")
    }

    fn is_join_target(&self) -> bool {
        matches!(self.role.as_str(), "targets" | "metadata" | "weights")
    }
}

// --------------------------------------------------------------------------- //
// Entry point                                                                 //
// --------------------------------------------------------------------------- //

pub fn propose_browser_dataset(
    files: &[NamedBytes],
    record_sets: &[DecodedRecordSet],
    confirmed: &[ConfirmedLock],
    conventions: Option<&[String]>,
) -> Result<ProposalResult, SpecError> {
    let mut plan = infer_browser_dataset(files, record_sets, conventions)?;
    let by_name: BTreeMap<String, &NamedBytes> =
        files.iter().map(|f| (f.name.clone(), f)).collect();

    let mut spec_val = plan
        .resolved_spec
        .as_ref()
        .map(|s| s.to_value())
        .unwrap_or_else(|| json!({"name": "dataset", "sources": []}));

    // (C2) Fill the gap left by `unknown` / partial inference: one provisional
    // source per un-sourced tabular file.
    let mut provisional: BTreeSet<String> = BTreeSet::new();
    synthesize_provisional_sources(&mut spec_val, files, &mut provisional);

    let mut confirmed_keys: BTreeSet<(String, String)> = BTreeSet::new();
    let mut echoes: Vec<Proposal> = Vec::new();

    // Pass 1 — non-pairing locks first, so source roles reflect the user's
    // confirmed roles before the pairing heuristic reasons over them.
    for lock in confirmed {
        if lock.kind == "pairing" {
            continue;
        }
        match apply_lock(&mut spec_val, lock) {
            LockOutcome::Applied => {
                confirmed_keys.insert((lock.kind.clone(), lock.target.clone()));
                echoes.push(echo_proposal(lock));
            }
            LockOutcome::Unresolved(message) => plan.warnings.push(message),
        }
    }

    // Facts now carry post-role-lock roles; the pairing heuristic + pairing-lock
    // anchor resolution use them.
    let facts = gather_source_facts(&spec_val, &by_name, record_sets);

    // Pass 2 — pairing locks (they rewrite join/key on the working spec).
    for lock in confirmed {
        if lock.kind != "pairing" {
            continue;
        }
        match apply_lock(&mut spec_val, lock) {
            LockOutcome::Applied => {
                confirmed_keys.insert((lock.kind.clone(), lock.target.clone()));
                echoes.push(echo_proposal(lock));
            }
            LockOutcome::Unresolved(message) => plan.warnings.push(message),
        }
    }

    // Parse must succeed; validation is surfaced non-fatally so an in-progress
    // (legitimately incomplete) dataset can keep being built.
    let spec = DatasetSpec::from_value(&spec_val)?;
    let (valid, validation_errors) = match validate_spec(&spec) {
        Ok(()) => (true, vec![]),
        Err(err) => (false, vec![err.message]),
    };

    let mut proposals: Vec<Proposal> = Vec::new();
    proposals.extend(structure_proposal(&plan, &confirmed_keys));
    proposals.extend(role_proposals(&spec_val, &provisional, &confirmed_keys));
    proposals.extend(partition_proposals(&spec_val, &confirmed_keys));
    proposals.extend(pairing_proposals(&facts, &confirmed_keys));
    proposals.extend(identity_proposal(&plan, &confirmed_keys));
    proposals.extend(decision_proposal(
        ProposalKind::SignalType,
        &plan.signal_type,
        &SIGNAL_TYPES,
        &confirmed_keys,
    ));
    proposals.extend(decision_proposal(
        ProposalKind::TaskType,
        &plan.task_type,
        &TASK_TYPES,
        &confirmed_keys,
    ));
    proposals.extend(echoes);
    proposals.sort_by(|a, b| {
        (a.kind.order(), a.target.as_str()).cmp(&(b.kind.order(), b.target.as_str()))
    });

    Ok(ProposalResult {
        plan,
        proposals,
        spec,
        valid,
        validation_errors,
    })
}

// --------------------------------------------------------------------------- //
// Provisional sources                                                         //
// --------------------------------------------------------------------------- //

fn synthesize_provisional_sources(
    spec_val: &mut Value,
    files: &[NamedBytes],
    provisional: &mut BTreeSet<String>,
) {
    let sources = match spec_val.get_mut("sources").and_then(Value::as_array_mut) {
        Some(s) => s,
        None => {
            spec_val
                .as_object_mut()
                .map(|m| m.insert("sources".into(), Value::Array(vec![])));
            spec_val.get_mut("sources").unwrap().as_array_mut().unwrap()
        }
    };

    let mut known_inputs: BTreeSet<String> = BTreeSet::new();
    for src in sources.iter() {
        for key in source_input_keys(src) {
            known_inputs.insert(file_stem(&key));
            known_inputs.insert(key);
        }
    }

    let base = sources.len();
    for (offset, file) in files
        .iter()
        .filter(|f| crate::infer::memory::looks_tabular(&f.name))
        .enumerate()
    {
        if known_inputs.contains(&file.name) || known_inputs.contains(&file_stem(&file.name)) {
            continue;
        }
        let source = provisional_source(file, base + offset);
        if let Some(id) = source.get("id").and_then(Value::as_str) {
            provisional.insert(id.to_string());
        }
        known_inputs.insert(file.name.clone());
        known_inputs.insert(file_stem(&file.name));
        sources.push(source);
    }
}

/// Build one source object from a single tabular file (mirrors the per-file
/// role logic of `infer_single_file`, but with a stable per-file id).
fn provisional_source(file: &NamedBytes, idx: usize) -> Value {
    let desc = describe_bytes(file);
    let id = unique_source_id(&file.name, idx);
    let params = LoadingParams {
        delimiter: Some(desc.delimiter.to_string()),
        has_header: Some(true),
        ..Default::default()
    };
    let mut source = Map::new();
    source.insert("id".into(), json!(id));
    source.insert("input".into(), json!(file.name));
    source.insert(
        "params".into(),
        json!({"delimiter": desc.delimiter.to_string(), "has_header": true}),
    );

    let Some(table) = read_table_bytes(&file.bytes, &params) else {
        source.insert("role".into(), json!("features"));
        return Value::Object(source);
    };
    let profile = table.to_table_profile();
    let guesses = infer_column_roles(&desc, &profile);
    let id_col = detect_sample_id(&profile).map(|g| g.column);

    let mut columns: Vec<Value> = Vec::new();
    for role in ["features", "targets", "metadata"] {
        let cols: Vec<Value> = guesses
            .iter()
            .filter(|g| g["role"].as_str() == Some(role) && g["col"].as_str() != id_col.as_deref())
            .map(|g| g["col"].clone())
            .collect();
        if !cols.is_empty() {
            columns.push(json!({"role": role, "select": cols}));
        }
    }

    let role = if columns.len() > 1 {
        "mixed"
    } else {
        columns
            .first()
            .and_then(|c| c["role"].as_str())
            .unwrap_or("features")
    };
    source.insert("role".into(), json!(role));
    // Emit per-column roles ONLY for a genuinely multi-role (`mixed`) table. The
    // assembler's `split_roles` assigns every non-key column to the source role
    // when `columns` is empty (and excludes the `key` column), so a single-role
    // table needs no `columns` — and keeping it `columns`-free lets a later role
    // lock rewrite the role the assembler actually reads.
    if columns.len() > 1 {
        source.insert("columns".into(), Value::Array(columns));
    }
    if let Some(col) = &id_col {
        source.insert("key".into(), json!(col));
    }
    Value::Object(source)
}

// --------------------------------------------------------------------------- //
// Source facts                                                                //
// --------------------------------------------------------------------------- //

fn gather_source_facts(
    spec_val: &Value,
    by_name: &BTreeMap<String, &NamedBytes>,
    record_sets: &[DecodedRecordSet],
) -> Vec<SourceFacts> {
    let mut facts = Vec::new();
    let Some(sources) = spec_val.get("sources").and_then(Value::as_array) else {
        return facts;
    };
    for src in sources {
        let id = src
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let input = source_first_input(src).unwrap_or_default();
        let role = src
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("features")
            .to_string();
        let partition = src
            .get("partition")
            .and_then(Value::as_str)
            .map(str::to_string);

        let (n_rows, unique_ids) = if let Some(file) = by_name.get(&input).or_else(|| {
            by_name
                .values()
                .find(|f| file_stem(&f.name) == file_stem(&input))
        }) {
            tabular_facts(file, src)
        } else if let Some(set) = record_sets.iter().find(|s| {
            !s.records.is_empty()
                && (s.source == input || file_stem(&s.source) == file_stem(&input))
        }) {
            decoded_facts(set)
        } else {
            (None, BTreeSet::new())
        };

        facts.push(SourceFacts {
            id,
            role,
            partition,
            n_rows,
            unique_ids,
        });
    }
    facts
}

fn tabular_facts(file: &NamedBytes, src: &Value) -> (Option<usize>, BTreeSet<String>) {
    let Some(table) = read_table_bytes(&file.bytes, &params_from(src)) else {
        return (None, BTreeSet::new());
    };
    let profile = table.to_table_profile();
    let unique_ids = profile
        .columns
        .iter()
        .filter(|c| c.is_unique && profile.n_rows > 0)
        .map(|c| c.name.clone())
        .collect();
    (Some(profile.n_rows), unique_ids)
}

fn decoded_facts(set: &DecodedRecordSet) -> (Option<usize>, BTreeSet<String>) {
    let mut ids: BTreeSet<String> = BTreeSet::new();
    for key in ["sample_id", "id"] {
        let values: Vec<String> = set
            .records
            .iter()
            .filter_map(|r| r.get("metadata").and_then(Value::as_object))
            .filter_map(|m| m.get(key))
            .filter_map(value_string)
            .collect();
        if values.len() == set.records.len()
            && values.iter().collect::<BTreeSet<_>>().len() == values.len()
        {
            ids.insert(format!("metadata.{key}"));
        }
    }
    (Some(set.records.len()), ids)
}

// --------------------------------------------------------------------------- //
// Lock application                                                            //
// --------------------------------------------------------------------------- //

enum LockOutcome {
    Applied,
    Unresolved(String),
}

fn apply_lock(spec_val: &mut Value, lock: &ConfirmedLock) -> LockOutcome {
    let Some(kind) = ProposalKind::from_str(&lock.kind) else {
        return LockOutcome::Unresolved(format!("unknown lock kind '{}'", lock.kind));
    };
    match kind {
        ProposalKind::Role => apply_role_lock(spec_val, lock),
        ProposalKind::Partition => {
            set_source_field(spec_val, &lock.target, "partition", lock.value.clone())
        }
        ProposalKind::Identity => apply_identity_lock(spec_val, lock),
        ProposalKind::Pairing => apply_pairing_lock(spec_val, lock),
        ProposalKind::SignalType => apply_signal_lock(spec_val, lock),
        ProposalKind::TaskType => apply_task_lock(spec_val, lock),
        ProposalKind::Folds => apply_top_level(spec_val, "folds", lock.value.clone()),
        // Structure is advisory: confirming it only suppresses its proposal.
        ProposalKind::Structure => LockOutcome::Applied,
    }
}

fn source_index(spec_val: &Value, target: &str) -> Option<usize> {
    let sources = spec_val.get("sources")?.as_array()?;
    sources
        .iter()
        .position(|s| s.get("id").and_then(Value::as_str) == Some(target))
        .or_else(|| {
            sources.iter().position(|s| {
                source_first_input(s)
                    .map(|i| i == target || file_stem(&i) == file_stem(target))
                    .unwrap_or(false)
            })
        })
}

fn set_source_field(spec_val: &mut Value, target: &str, field: &str, value: Value) -> LockOutcome {
    let Some(idx) = source_index(spec_val, target) else {
        return LockOutcome::Unresolved(format!("lock target '{target}' matched no source"));
    };
    if let Some(obj) = spec_val["sources"][idx].as_object_mut() {
        obj.insert(field.into(), value);
    }
    LockOutcome::Applied
}

/// Confirm a source's role. The assembler's `split_roles` honours per-column
/// `columns` over the source `role`, so a leaf-role lock must drop any inferred
/// `columns` for the new role to take effect on the whole table (the `key`
/// column is still excluded from the role).
fn apply_role_lock(spec_val: &mut Value, lock: &ConfirmedLock) -> LockOutcome {
    let Some(idx) = source_index(spec_val, &lock.target) else {
        return LockOutcome::Unresolved(format!("lock target '{}' matched no source", lock.target));
    };
    if let Some(obj) = spec_val["sources"][idx].as_object_mut() {
        obj.insert("role".into(), lock.value.clone());
        if lock.value.as_str() != Some("mixed") {
            obj.remove("columns");
        }
    }
    LockOutcome::Applied
}

fn apply_identity_lock(spec_val: &mut Value, lock: &ConfirmedLock) -> LockOutcome {
    let sample_index = match &lock.value {
        Value::String(col) => json!({"by": "id", "key": col}),
        Value::Object(_) => lock.value.clone(),
        _ => return LockOutcome::Unresolved("identity lock needs a column or sample_index".into()),
    };
    let key_col = sample_index
        .get("key")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(obj) = spec_val.as_object_mut() {
        obj.insert("sample_index".into(), sample_index);
    }
    if let Some(col) = key_col {
        if let Some(sources) = spec_val.get_mut("sources").and_then(Value::as_array_mut) {
            for src in sources.iter_mut() {
                let feature_like = matches!(
                    src.get("role").and_then(Value::as_str),
                    Some("features") | Some("mixed")
                );
                if feature_like {
                    if let Some(o) = src.as_object_mut() {
                        o.insert("key".into(), json!(col));
                    }
                }
            }
        }
    }
    LockOutcome::Applied
}

fn apply_pairing_lock(spec_val: &mut Value, lock: &ConfirmedLock) -> LockOutcome {
    let mode = lock.value.get("mode").and_then(Value::as_str).unwrap_or("");
    if mode == "concat_samples" {
        return apply_concat_samples(spec_val, lock);
    }
    let Some((left, right)) = lock.target.split_once('|') else {
        return LockOutcome::Unresolved(format!("pairing target '{}' is not a|b", lock.target));
    };
    let (Some(li), Some(ri)) = (source_index(spec_val, left), source_index(spec_val, right)) else {
        return LockOutcome::Unresolved(format!(
            "pairing target '{}' matched no source",
            lock.target
        ));
    };
    // Anchor = the feature-like side; the join lives on the other (target/meta)
    // side, because the assembler joins each non-primary source ONTO the primary
    // feature frame (`join_onto`): `left_on` is resolved in the feature frame,
    // `right_on` in the joined source's own frame.
    let (anchor_idx, joined_idx) = if source_is_feature_like(spec_val, li) {
        (li, ri)
    } else {
        (ri, li)
    };
    let anchor_id = spec_val["sources"][anchor_idx]["id"]
        .as_str()
        .unwrap_or("")
        .to_string();
    match mode {
        "join_id" => {
            // Write explicit directional keys (Codex #3): `on` shorthand cannot
            // express different left/right names; default both to the shared col.
            let on = lock.value.get("on").cloned();
            let left_on = lock
                .value
                .get("left_on")
                .cloned()
                .or_else(|| on.clone())
                .unwrap_or(Value::Null);
            let right_on = lock
                .value
                .get("right_on")
                .cloned()
                .or(on)
                .unwrap_or(Value::Null);
            if left_on.is_null() || right_on.is_null() {
                return LockOutcome::Unresolved(
                    "join_id lock needs 'on' or left_on/right_on".into(),
                );
            }
            let join = json!({
                "to": anchor_id,
                "left_on": left_on,
                "right_on": right_on,
                "cardinality": "1:1",
                "coverage": "complete",
            });
            if let Some(obj) = spec_val["sources"][joined_idx].as_object_mut() {
                obj.insert("join".into(), join);
            }
        }
        "row_order" => {
            // Positional alignment for THIS pair only: clear the joined source's
            // key/join so `join_onto` falls through to `row_align`. Leave the
            // anchor key intact (Codex #4) so other key-joins still work.
            if let Some(obj) = spec_val["sources"][joined_idx].as_object_mut() {
                obj.remove("join");
                obj.remove("key");
            }
        }
        other => {
            return LockOutcome::Unresolved(format!("unknown pairing mode '{other}'"));
        }
    }
    LockOutcome::Applied
}

/// Fold the sample-summing feature parts into a single multi-input
/// `concat_samples` features source (the materializable reading of
/// "X_a + X_b have the same row count as Y"): stacking the parts row-wise yields
/// a feature table the assembler row-aligns 1:1 with the whole target. Replaces
/// the earlier `partition_sum`, which left the single whole target unpartitioned
/// and thus excluded from every block (Codex #1).
fn apply_concat_samples(spec_val: &mut Value, lock: &ConfirmedLock) -> LockOutcome {
    let Some(parts) = lock.value.get("parts").and_then(Value::as_array) else {
        return LockOutcome::Unresolved("concat_samples needs 'parts'".into());
    };
    let part_ids: Vec<String> = parts
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect();
    if part_ids.len() < 2 {
        return LockOutcome::Unresolved("concat_samples needs >=2 parts".into());
    }
    // Collect the file inputs of every part (in order) and their id keys: if all
    // parts agree on a key, keep it so the assembler keeps excluding the id
    // column from X (else `split_roles` would coerce e.g. `sample_id` into a NaN
    // feature column — Codex follow-up).
    let mut inputs: Vec<Value> = Vec::new();
    let mut keys: Vec<Value> = Vec::new();
    for id in &part_ids {
        let Some(idx) = source_index(spec_val, id) else {
            return LockOutcome::Unresolved(format!("concat part '{id}' matched no source"));
        };
        match spec_val["sources"][idx].get("input") {
            Some(Value::Array(a)) => inputs.extend(a.iter().cloned()),
            Some(other) => inputs.push(other.clone()),
            None => {}
        }
        keys.push(
            spec_val["sources"][idx]
                .get("key")
                .cloned()
                .unwrap_or(Value::Null),
        );
    }
    let first_key = keys[0].clone();
    let common_key = if !first_key.is_null() && keys.iter().all(|k| *k == first_key) {
        Some(first_key)
    } else {
        None
    };

    // Rewrite the first part into the merged source; drop the rest.
    let first_idx = source_index(spec_val, &part_ids[0]).unwrap();
    if let Some(obj) = spec_val["sources"][first_idx].as_object_mut() {
        obj.insert("input".into(), Value::Array(inputs));
        obj.insert("merge".into(), json!("concat_samples"));
        obj.insert("role".into(), json!("features"));
        obj.remove("columns");
        obj.remove("partition");
        match &common_key {
            Some(k) => {
                obj.insert("key".into(), k.clone());
            }
            None => {
                obj.remove("key");
            }
        }
    }
    let drop_ids: BTreeSet<&str> = part_ids[1..].iter().map(String::as_str).collect();
    if let Some(sources) = spec_val.get_mut("sources").and_then(Value::as_array_mut) {
        sources.retain(|s| {
            s.get("id")
                .and_then(Value::as_str)
                .map(|id| !drop_ids.contains(id))
                .unwrap_or(true)
        });
    }
    if let Some(whole) = lock.value.get("whole").and_then(Value::as_str) {
        if let Some(idx) = source_index(spec_val, whole) {
            if let Some(obj) = spec_val["sources"][idx].as_object_mut() {
                obj.insert("role".into(), json!("targets"));
            }
        }
    }
    LockOutcome::Applied
}

fn apply_signal_lock(spec_val: &mut Value, lock: &ConfirmedLock) -> LockOutcome {
    let Some(signal) = lock.value.as_str() else {
        return LockOutcome::Unresolved("signal_type lock needs a string".into());
    };
    let obj = spec_val.as_object_mut().unwrap();
    let params = obj
        .entry("params")
        .or_insert_with(|| Value::Object(Map::new()));
    if let Some(p) = params.as_object_mut() {
        p.insert("signal_type".into(), json!(signal));
    }
    LockOutcome::Applied
}

fn apply_task_lock(spec_val: &mut Value, lock: &ConfirmedLock) -> LockOutcome {
    let Some(task) = lock.value.as_str() else {
        return LockOutcome::Unresolved("task_type lock needs a string".into());
    };
    let obj = spec_val.as_object_mut().unwrap();
    obj.insert("task_type".into(), json!(task));
    if matches!(task, "binary" | "multiclass") {
        obj.insert("aggregate".into(), json!({"method": "vote"}));
    }
    LockOutcome::Applied
}

fn apply_top_level(spec_val: &mut Value, field: &str, value: Value) -> LockOutcome {
    if let Some(obj) = spec_val.as_object_mut() {
        obj.insert(field.into(), value);
    }
    LockOutcome::Applied
}

fn echo_proposal(lock: &ConfirmedLock) -> Proposal {
    let kind = ProposalKind::from_str(&lock.kind).unwrap_or(ProposalKind::Structure);
    let mut p = Proposal::open(
        kind,
        lock.target.clone(),
        lock.value.clone(),
        1.0,
        vec!["confirmed by user".into()],
    );
    p.status = ProposalStatus::from_lock(lock.status.as_deref());
    p
}

// --------------------------------------------------------------------------- //
// Proposal generation                                                         //
// --------------------------------------------------------------------------- //

fn is_confirmed(keys: &BTreeSet<(String, String)>, kind: ProposalKind, target: &str) -> bool {
    keys.contains(&(kind.as_str().to_string(), target.to_string()))
}

fn structure_proposal(plan: &DatasetPlan, keys: &BTreeSet<(String, String)>) -> Vec<Proposal> {
    if is_confirmed(keys, ProposalKind::Structure, "dataset") {
        return vec![];
    }
    let Some(decision) = &plan.structure else {
        return vec![];
    };
    let value = decision.value.clone();
    let ambiguous = value.as_str() == Some("unknown");
    vec![Proposal::open(
        ProposalKind::Structure,
        "dataset",
        value,
        decision.score,
        decision.evidence.clone(),
    )
    .with_ambiguous(ambiguous)]
}

fn role_proposals(
    spec_val: &Value,
    provisional: &BTreeSet<String>,
    keys: &BTreeSet<(String, String)>,
) -> Vec<Proposal> {
    let Some(sources) = spec_val.get("sources").and_then(Value::as_array) else {
        return vec![];
    };
    let mut out = Vec::new();
    for src in sources {
        let Some(id) = src.get("id").and_then(Value::as_str) else {
            continue;
        };
        if is_confirmed(keys, ProposalKind::Role, id) {
            continue;
        }
        let role = src
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("features");
        // A `mixed` source already declares per-column roles; its role is not a
        // single guess to validate, so skip it.
        if role == "mixed" {
            continue;
        }
        let is_provisional = provisional.contains(id);
        let score = if is_provisional { 0.6 } else { 0.85 };
        let evidence = if is_provisional {
            vec![format!(
                "provisional source from '{}'; role inferred from columns",
                source_first_input(src).unwrap_or_default()
            )]
        } else {
            vec![format!("role '{role}' inferred for source '{id}'")]
        };
        let alternatives = LEAF_ROLES
            .iter()
            .filter(|r| **r != role)
            .map(|r| Candidate::new(json!(r), 0.3, vec![format!("treat as {r}")]))
            .collect();
        out.push(
            Proposal::open(ProposalKind::Role, id, json!(role), score, evidence)
                .with_alternatives(alternatives)
                .with_ambiguous(is_provisional),
        );
    }
    out
}

fn partition_proposals(spec_val: &Value, keys: &BTreeSet<(String, String)>) -> Vec<Proposal> {
    let Some(sources) = spec_val.get("sources").and_then(Value::as_array) else {
        return vec![];
    };
    let mut out = Vec::new();
    for src in sources {
        let Some(id) = src.get("id").and_then(Value::as_str) else {
            continue;
        };
        if is_confirmed(keys, ProposalKind::Partition, id) {
            continue;
        }
        let current = src.get("partition").and_then(Value::as_str);
        let input = source_first_input(src).unwrap_or_default();
        let from_name = infer_partition_from_name(&input);
        // Only surface a partition decision when there is evidence for one
        // (already assigned, or the filename implies train/test).
        let (value, score, evidence) = match (current, from_name) {
            (Some(p), _) => (
                p.to_string(),
                0.85,
                vec![format!("source '{id}' assigned to '{p}'")],
            ),
            (None, Some(p)) => (
                p.to_string(),
                0.7,
                vec![format!("filename '{input}' implies the '{p}' partition")],
            ),
            (None, None) => continue,
        };
        let alternatives = ["train", "test", "predict"]
            .iter()
            .filter(|p| **p != value)
            .map(|p| Candidate::new(json!(p), 0.3, vec![format!("assign to {p}")]))
            .collect();
        out.push(
            Proposal::open(ProposalKind::Partition, id, json!(value), score, evidence)
                .with_alternatives(alternatives),
        );
    }
    out
}

fn identity_proposal(plan: &DatasetPlan, keys: &BTreeSet<(String, String)>) -> Vec<Proposal> {
    if is_confirmed(keys, ProposalKind::Identity, "dataset") {
        return vec![];
    }
    let Some(decision) = &plan.identity else {
        return vec![];
    };
    let alternatives = vec![Candidate::new(
        json!({"by": "row"}),
        0.3,
        vec!["align samples by row order instead".into()],
    )];
    vec![Proposal::open(
        ProposalKind::Identity,
        "dataset",
        decision.value.clone(),
        decision.score,
        decision.evidence.clone(),
    )
    .with_alternatives(alternatives)
    .with_ambiguous(decision.ambiguous)]
}

fn decision_proposal(
    kind: ProposalKind,
    decision: &Option<Decision>,
    vocabulary: &[&str],
    keys: &BTreeSet<(String, String)>,
) -> Vec<Proposal> {
    if is_confirmed(keys, kind, "dataset") {
        return vec![];
    }
    let Some(decision) = decision else {
        return vec![];
    };
    let Some(value) = decision.value.as_str() else {
        return vec![];
    };
    if value == "auto" || value == "unknown" {
        return vec![];
    }
    let alternatives = vocabulary
        .iter()
        .filter(|v| **v != value)
        .map(|v| Candidate::new(json!(v), 0.2, vec![format!("set to {v}")]))
        .collect();
    vec![Proposal::open(
        kind,
        "dataset",
        json!(value),
        decision.score,
        decision.evidence.clone(),
    )
    .with_alternatives(alternatives)
    .with_ambiguous(decision.ambiguous)]
}

// --------------------------------------------------------------------------- //
// Pairing-by-row-count heuristic                                              //
// --------------------------------------------------------------------------- //

fn pairing_proposals(facts: &[SourceFacts], keys: &BTreeSet<(String, String)>) -> Vec<Proposal> {
    let mut out = Vec::new();
    out.extend(equal_count_pairings(facts, keys));
    out.extend(sum_pairings(facts, keys));
    out
}

fn equal_count_pairings(facts: &[SourceFacts], keys: &BTreeSet<(String, String)>) -> Vec<Proposal> {
    // Count, per source, how many equal-count counterparts it has — multiple
    // candidates mean the pairing is genuinely ambiguous and must be downgraded.
    let mut participation: BTreeMap<usize, usize> = BTreeMap::new();
    let pairs: Vec<(usize, usize)> = candidate_pairs(facts);
    for &(i, j) in &pairs {
        *participation.entry(i).or_default() += 1;
        *participation.entry(j).or_default() += 1;
    }

    let mut out = Vec::new();
    for (i, j) in pairs {
        let a = &facts[i];
        let b = &facts[j];
        let target = format!("{}|{}", a.id, b.id);
        if is_confirmed(keys, ProposalKind::Pairing, &target) {
            continue;
        }
        let n = a.n_rows.unwrap_or(0);
        let shared: Vec<&String> = a.unique_ids.intersection(&b.unique_ids).collect();
        let many = participation.get(&i).copied().unwrap_or(0) > 1
            || participation.get(&j).copied().unwrap_or(0) > 1;

        // No `separate` mode: the assembler always combines the sources in a
        // block, so "separate" isn't expressible — leaving a pairing unconfirmed
        // is how the user declines it (pairings never auto-apply).
        let (value, score, evidence, alternatives) = if let Some(col) = shared.first() {
            (
                json!({"mode": "join_id", "on": col}),
                if many { 0.7 } else { 0.9 },
                vec![format!(
                    "'{}' and '{}' share a unique id column '{}' ({} rows each)",
                    a.id, b.id, col, n
                )],
                vec![Candidate::new(
                    json!({"mode": "row_order"}),
                    0.4,
                    vec!["align by row order instead of the shared id".into()],
                )],
            )
        } else {
            (
                json!({"mode": "row_order"}),
                if many { 0.3 } else { 0.45 },
                vec![format!(
                    "'{}' and '{}' have equal row counts ({}) but no shared id column{}",
                    a.id,
                    b.id,
                    n,
                    if many {
                        " — multiple equal-count candidates, confirm carefully"
                    } else {
                        ""
                    }
                )],
                vec![],
            )
        };
        let ambiguous = many || shared.is_empty();
        out.push(
            Proposal::open(ProposalKind::Pairing, target, value, score, evidence)
                .with_alternatives(alternatives)
                .with_ambiguous(ambiguous),
        );
    }
    out
}

/// Feature×(target/meta) pairs with equal, positive row counts and compatible
/// partitions, in deterministic `(i<j)` declaration order.
fn candidate_pairs(facts: &[SourceFacts]) -> Vec<(usize, usize)> {
    let mut pairs = Vec::new();
    for i in 0..facts.len() {
        for j in (i + 1)..facts.len() {
            let a = &facts[i];
            let b = &facts[j];
            let (Some(na), Some(nb)) = (a.n_rows, b.n_rows) else {
                continue;
            };
            if na == 0 || na != nb {
                continue;
            }
            let role_ok = (a.is_feature_like() && b.is_join_target())
                || (b.is_feature_like() && a.is_join_target());
            if !role_ok || !partitions_compatible(&a.partition, &b.partition) {
                continue;
            }
            pairs.push((i, j));
        }
    }
    pairs
}

fn partitions_compatible(a: &Option<String>, b: &Option<String>) -> bool {
    match (a, b) {
        (Some(x), Some(y)) => x == y,
        _ => true,
    }
}

fn sum_pairings(facts: &[SourceFacts], keys: &BTreeSet<(String, String)>) -> Vec<Proposal> {
    let mut out = Vec::new();
    let feature_idx: Vec<usize> = (0..facts.len())
        .filter(|&i| facts[i].is_feature_like() && facts[i].n_rows.unwrap_or(0) > 0)
        .collect();
    for (yi, y) in facts.iter().enumerate() {
        if !y.is_join_target() {
            continue;
        }
        let Some(ny) = y.n_rows.filter(|&n| n > 0) else {
            continue;
        };
        let Some(subset) = first_subset_summing(&feature_idx, facts, ny) else {
            continue;
        };
        if subset.len() < 2 {
            continue;
        }
        let part_ids: Vec<String> = subset.iter().map(|&i| facts[i].id.clone()).collect();
        // Target includes the whole so two different wholes for the same feature
        // subset get distinct, stable proposal ids (Codex #6).
        let target = format!("{}=>{}", part_ids.join("+"), facts[yi].id);
        if is_confirmed(keys, ProposalKind::Pairing, &target) {
            continue;
        }
        let names = subset
            .iter()
            .map(|&i| format!("{} ({})", facts[i].id, facts[i].n_rows.unwrap_or(0)))
            .collect::<Vec<_>>()
            .join(" + ");
        out.push(
            Proposal::open(
                ProposalKind::Pairing,
                target,
                json!({
                    "mode": "concat_samples",
                    "parts": part_ids,
                    "whole": facts[yi].id,
                }),
                0.5,
                vec![format!(
                    "{names} = {} ({} rows): stack the feature files (concat_samples) to align 1:1 with '{}' — only correct if the parts share the same feature columns",
                    facts[yi].id, ny, facts[yi].id
                )],
            )
            .with_ambiguous(true),
        );
    }
    out
}

/// First subset (size 2..=4, declaration order) of `candidates` whose row
/// counts sum to `target`. Deterministic: returns the earliest match.
fn first_subset_summing(
    candidates: &[usize],
    facts: &[SourceFacts],
    target: usize,
) -> Option<Vec<usize>> {
    let n = candidates.len();
    for size in 2..=4usize.min(n) {
        if let Some(s) = subset_of_size(candidates, facts, target, size, 0, &mut Vec::new()) {
            return Some(s);
        }
    }
    None
}

fn subset_of_size(
    candidates: &[usize],
    facts: &[SourceFacts],
    target: usize,
    size: usize,
    start: usize,
    chosen: &mut Vec<usize>,
) -> Option<Vec<usize>> {
    if chosen.len() == size {
        let sum: usize = chosen.iter().map(|&i| facts[i].n_rows.unwrap_or(0)).sum();
        return (sum == target).then(|| chosen.clone());
    }
    for k in start..candidates.len() {
        chosen.push(candidates[k]);
        if let Some(found) = subset_of_size(candidates, facts, target, size, k + 1, chosen) {
            return Some(found);
        }
        chosen.pop();
    }
    None
}

// --------------------------------------------------------------------------- //
// Small helpers                                                               //
// --------------------------------------------------------------------------- //

fn source_is_feature_like(spec_val: &Value, idx: usize) -> bool {
    matches!(
        spec_val["sources"][idx].get("role").and_then(Value::as_str),
        Some("features") | Some("mixed")
    )
}

fn source_input_keys(source: &Value) -> Vec<String> {
    match source.get("input") {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        _ => vec![],
    }
}

fn value_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
