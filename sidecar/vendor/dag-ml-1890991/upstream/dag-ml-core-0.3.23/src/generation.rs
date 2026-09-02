use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::campaign::stable_json_fingerprint;
use crate::error::{DagMlError, Result};
use crate::ids::{NodeId, VariantId};
use crate::rng::SeedContext;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GenerationStrategy {
    #[default]
    None,
    Cartesian,
    Zip,
}

/// A reference to a single dimension choice — `dimension` is a [`GenerationDimension::name`] and
/// `label` a [`GenerationChoice::label`] within it. Generation constraints are expressed as sets of
/// these refs; a variant "contains" the ref when its selected choice for `dimension` carries `label`.
///
/// `Ord` is derived so refs can live in deterministically-ordered collections (sorted constraint
/// groups, stable fingerprints).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ChoiceRef {
    pub dimension: String,
    pub label: String,
}

/// Declarative pruning constraints applied to the enumerated variant set BEFORE materialization.
///
/// All three keywords are read off the same `(dimension, label)` coordinate space ([`ChoiceRef`]):
///
/// * `mutex` — the FULL group may not all co-occur in one variant (a group of 2+ refs); a variant
///   is pruned only when every member is present. For a PAIR this is "the two may not co-occur";
///   for 3+ members only the single all-present variant is forbidden, every proper subset survives.
/// * `requires` — choosing the first ref of a pair requires the second to be present too.
/// * `exclude` — the first and second ref of a pair may not both be present.
///
/// The keywords mirror the nirs4all generation oracle's `_mutex_` / `_requires_` / `_exclude_`. The
/// oracle's fourth keyword `_depends_on_` is a DEAD keyword with no filter semantics and is omitted
/// here on purpose.
///
/// ADDITIVE: every field is `skip_serializing_if = "Vec::is_empty"` and the whole value is skipped
/// when empty on [`GenerationSpec`], so a constraint-free spec serializes byte-identically to before
/// this field existed (its fingerprint is unchanged).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GenerationConstraints {
    /// Mutual-exclusion groups: the FULL group may not all co-occur in one variant (matching the
    /// nirs4all legacy `issubset` rule). A variant is pruned only when every member is present —
    /// for a pair this is "not both", for 3+ only the all-present variant drops (subsets survive).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mutex: Vec<Vec<ChoiceRef>>,
    /// Dependency pairs `(a, b)`: if `a` is present, `b` must also be present.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requires: Vec<(ChoiceRef, ChoiceRef)>,
    /// Forbidden pairs `(a, b)`: `a` and `b` may not both be present.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exclude: Vec<(ChoiceRef, ChoiceRef)>,
}

impl GenerationConstraints {
    pub fn is_empty(&self) -> bool {
        self.mutex.is_empty() && self.requires.is_empty() && self.exclude.is_empty()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GenerationChoice {
    pub label: String,
    pub value: serde_json::Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub param_overrides: Vec<GenerationParamOverride>,
    /// Operator-level variant: names the alternative sub-sequence this choice selects, distinct
    /// from a parameter variant (`param_overrides`). A choice with neither field is a value-only
    /// dimension; a choice may carry param_overrides XOR active_subsequence, never both. Skipped
    /// (None) when absent, so existing specs/fixtures stay byte-identical (Phase 2: no behavior).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_subsequence: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GenerationParamOverride {
    pub node_id: NodeId,
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
}

impl GenerationChoice {
    fn validate(&self, dimension_name: &str) -> Result<()> {
        if self.label.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "generation dimension `{dimension_name}` has an empty choice label"
            )));
        }
        if !self.param_overrides.is_empty() && self.active_subsequence.is_some() {
            return Err(DagMlError::CampaignValidation(format!(
                "generation choice `{}` in dimension `{dimension_name}` cannot set both param_overrides and active_subsequence",
                self.label
            )));
        }
        if let Some(active_subsequence) = &self.active_subsequence {
            if active_subsequence.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "generation choice `{}` in dimension `{dimension_name}` has an empty active_subsequence",
                    self.label
                )));
            }
        }
        for override_spec in &self.param_overrides {
            override_spec.validate(dimension_name, &self.label)?;
        }
        Ok(())
    }
}

impl GenerationParamOverride {
    fn validate(&self, dimension_name: &str, choice_label: &str) -> Result<()> {
        if self.params.is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "generation choice `{choice_label}` in dimension `{dimension_name}` has an empty param override for node `{}`",
                self.node_id
            )));
        }
        for key in self.params.keys() {
            if key.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "generation choice `{choice_label}` in dimension `{dimension_name}` has an empty param override key for node `{}`",
                    self.node_id
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GenerationDimension {
    pub name: String,
    #[serde(default)]
    pub choices: Vec<GenerationChoice>,
}

impl GenerationDimension {
    fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(
                "generation dimension name is empty".to_string(),
            ));
        }
        if self.choices.is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "generation dimension `{}` has no choices",
                self.name
            )));
        }
        let mut labels = BTreeSet::new();
        for choice in &self.choices {
            choice.validate(&self.name)?;
            if !labels.insert(choice.label.as_str()) {
                return Err(DagMlError::CampaignValidation(format!(
                    "generation dimension `{}` has duplicate choice `{}`",
                    self.name, choice.label
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GenerationSpec {
    #[serde(default)]
    pub strategy: GenerationStrategy,
    #[serde(default)]
    pub dimensions: Vec<GenerationDimension>,
    #[serde(default)]
    pub max_variants: Option<usize>,
    /// Variant-pruning constraints (`mutex` / `requires` / `exclude`). ADDITIVE: skipped when empty,
    /// so a constraint-free spec is byte-identical (and fingerprint-stable) to before this field.
    #[serde(default, skip_serializing_if = "GenerationConstraints::is_empty")]
    pub constraints: GenerationConstraints,
}

impl Default for GenerationSpec {
    fn default() -> Self {
        Self {
            strategy: GenerationStrategy::None,
            dimensions: Vec::new(),
            max_variants: Some(1),
            constraints: GenerationConstraints::default(),
        }
    }
}

impl GenerationSpec {
    pub fn validate(&self) -> Result<()> {
        if self.max_variants == Some(0) {
            return Err(DagMlError::CampaignValidation(
                "generation max_variants cannot be zero".to_string(),
            ));
        }
        if self.strategy == GenerationStrategy::None {
            if !self.dimensions.is_empty() {
                return Err(DagMlError::CampaignValidation(
                    "generation dimensions require cartesian or zip strategy".to_string(),
                ));
            }
            if !self.constraints.is_empty() {
                return Err(DagMlError::CampaignValidation(
                    "generation constraints require cartesian or zip strategy".to_string(),
                ));
            }
            return Ok(());
        }

        if self.dimensions.is_empty() {
            return Err(DagMlError::CampaignValidation(
                "generation strategy requires at least one dimension".to_string(),
            ));
        }
        let mut names = BTreeSet::new();
        for dimension in &self.dimensions {
            dimension.validate()?;
            if !names.insert(dimension.name.as_str()) {
                return Err(DagMlError::CampaignValidation(format!(
                    "duplicate generation dimension `{}`",
                    dimension.name
                )));
            }
        }
        if self.strategy == GenerationStrategy::Zip {
            let expected = self.dimensions[0].choices.len();
            if self
                .dimensions
                .iter()
                .any(|dimension| dimension.choices.len() != expected)
            {
                return Err(DagMlError::CampaignValidation(
                    "zip generation requires every dimension to have the same number of choices"
                        .to_string(),
                ));
            }
        }
        self.validate_constraints()?;
        Ok(())
    }

    /// Validate that every [`ChoiceRef`] in the constraints resolves to an existing
    /// `(dimension, label)` and that each constraint group is well-formed (mutex needs >= 2 distinct
    /// refs; a requires/exclude pair needs two distinct refs).
    fn validate_constraints(&self) -> Result<()> {
        if self.constraints.is_empty() {
            return Ok(());
        }
        let mut valid = BTreeSet::<(&str, &str)>::new();
        for dimension in &self.dimensions {
            for choice in &dimension.choices {
                valid.insert((dimension.name.as_str(), choice.label.as_str()));
            }
        }
        let check = |reference: &ChoiceRef| -> Result<()> {
            if !valid.contains(&(reference.dimension.as_str(), reference.label.as_str())) {
                return Err(DagMlError::CampaignValidation(format!(
                    "generation constraint references unknown choice `{}:{}`",
                    reference.dimension, reference.label
                )));
            }
            Ok(())
        };
        for group in &self.constraints.mutex {
            if group.len() < 2 {
                return Err(DagMlError::CampaignValidation(
                    "generation mutex group requires at least two choices".to_string(),
                ));
            }
            let mut distinct = BTreeSet::new();
            for reference in group {
                check(reference)?;
                if !distinct.insert((reference.dimension.as_str(), reference.label.as_str())) {
                    return Err(DagMlError::CampaignValidation(format!(
                        "generation mutex group repeats choice `{}:{}`",
                        reference.dimension, reference.label
                    )));
                }
            }
        }
        for (group_label, pairs) in [
            ("requires", &self.constraints.requires),
            ("exclude", &self.constraints.exclude),
        ] {
            for (left, right) in pairs {
                check(left)?;
                check(right)?;
                if left == right {
                    return Err(DagMlError::CampaignValidation(format!(
                        "generation {group_label} pair repeats choice `{}:{}`",
                        left.dimension, left.label
                    )));
                }
            }
        }
        Ok(())
    }
}

/// An operator-level variant model lowered from a single operator-level generator (Mechanism B's
/// `PipelineDslStep::Generator`): a [`GenerationDimension`] whose every choice carries an
/// `active_subsequence` (the choice's namespace key) — never `param_overrides` — paired with the
/// EXACT set of namespaced node ids that choice activates.
///
/// The dimension is the search-space shape; `active_nodes` is the authoritative per-choice active
/// set. Each entry is keyed by the choice's `active_subsequence` (identical to the matching
/// choice's `active_subsequence`) and holds the node ids minted by
/// `namespace_generated_sequence` for that choice — collected at the deterministic minting point,
/// never by prefix-matching node id strings. `enumerate_variants` over `dimension`'s parent spec
/// yields one [`VariantPlan`] per operator choice.
///
/// This model is produced by a NEW, opt-in compile entry point. It is NOT folded into
/// `CompiledPipelineDsl.generation` / `search_space_fingerprint`, so the existing Mechanism B
/// compilation (graph, OOF lanes, fingerprints) stays byte-identical.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OperatorVariantModel {
    /// The generator id this model lowers (the `PipelineDslStep::Generator` `id`).
    pub generator_id: NodeId,
    /// The operator dimension: one `active_subsequence`-only choice per operator sub-sequence.
    pub dimension: GenerationDimension,
    /// `active_subsequence` (choice key) -> the exact namespaced node ids that choice activates.
    #[serde(default)]
    pub active_nodes: BTreeMap<String, BTreeSet<NodeId>>,
    /// `active_subsequence` (choice key) -> the choice's `variant_label`: the cross-language content
    /// fingerprint (hex sha256) of that choice's LOWERED operator sub-sequence (Phase 5). The host
    /// recomputes the SAME bytes from its own operator-choice config (via the public
    /// [`operator_variant_label`](crate::operator_variant_label), exposed through the dag-ml-py
    /// binding) to map a per-variant report back to the config, so the canonical form is a strict
    /// cross-language CONTRACT. Empty (`default`) for an operator model carrying no labels; otherwise
    /// it is a strict bijection with the choices' `active_subsequence`, exactly parallel to
    /// `active_nodes`.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub variant_labels: BTreeMap<String, String>,
}

impl OperatorVariantModel {
    /// Validate the operator dimension and its active-node-id sets.
    ///
    /// Beyond `GenerationDimension::validate`, this enforces a STRICT BIJECTION between the choices
    /// and `active_nodes`: every choice is operator-only (an `active_subsequence`, no
    /// `param_overrides`); the choices' `active_subsequence` values are unique; every choice has
    /// exactly one non-empty `active_nodes` entry keyed by its `active_subsequence`; and
    /// `active_nodes` carries no stray key that does not correspond to a choice.
    pub fn validate(&self) -> Result<()> {
        self.dimension.validate()?;
        let mut active_subsequences = BTreeSet::new();
        for choice in &self.dimension.choices {
            if !choice.param_overrides.is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "operator variant model `{}` choice `{}` must not carry param_overrides",
                    self.generator_id, choice.label
                )));
            }
            let Some(active_subsequence) = &choice.active_subsequence else {
                return Err(DagMlError::CampaignValidation(format!(
                    "operator variant model `{}` choice `{}` is missing an active_subsequence",
                    self.generator_id, choice.label
                )));
            };
            if !active_subsequences.insert(active_subsequence.as_str()) {
                return Err(DagMlError::CampaignValidation(format!(
                    "operator variant model `{}` has duplicate active_subsequence `{active_subsequence}`",
                    self.generator_id
                )));
            }
            let Some(nodes) = self.active_nodes.get(active_subsequence) else {
                return Err(DagMlError::CampaignValidation(format!(
                    "operator variant model `{}` choice `{}` has no active-node set for `{active_subsequence}`",
                    self.generator_id, choice.label
                )));
            };
            if nodes.is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "operator variant model `{}` choice `{}` has an empty active-node set",
                    self.generator_id, choice.label
                )));
            }
        }
        // No stray active_nodes key: every key must correspond to a choice active_subsequence.
        for key in self.active_nodes.keys() {
            if !active_subsequences.contains(key.as_str()) {
                return Err(DagMlError::CampaignValidation(format!(
                    "operator variant model `{}` has a stray active-node set `{key}` with no matching choice",
                    self.generator_id
                )));
            }
        }
        // `variant_labels` is populated in Phase 5 (the cross-language content fingerprints). When
        // present it is a STRICT BIJECTION with the choices (every choice keyed by its
        // `active_subsequence`, every label a 64-hex sha256, no stray key) — exactly like
        // `active_nodes`. An empty map is the pre-Phase-5 / label-less shape and is left untouched so
        // hand-built fixtures without labels still validate.
        if !self.variant_labels.is_empty() {
            for active_subsequence in &active_subsequences {
                let Some(label) = self.variant_labels.get(*active_subsequence) else {
                    return Err(DagMlError::CampaignValidation(format!(
                        "operator variant model `{}` has no variant_label for `{active_subsequence}`",
                        self.generator_id
                    )));
                };
                if label.len() != 64 || !label.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                    return Err(DagMlError::CampaignValidation(format!(
                        "operator variant model `{}` variant_label for `{active_subsequence}` is not a 64-hex sha256",
                        self.generator_id
                    )));
                }
            }
            for key in self.variant_labels.keys() {
                if !active_subsequences.contains(key.as_str()) {
                    return Err(DagMlError::CampaignValidation(format!(
                        "operator variant model `{}` has a stray variant_label `{key}` with no matching choice",
                        self.generator_id
                    )));
                }
            }
        }
        Ok(())
    }

    /// Build a single-dimension [`GenerationSpec`] (cartesian over the one operator dimension) so
    /// `enumerate_variants` yields one [`VariantPlan`] per operator choice.
    ///
    /// The constraints are intentionally `default()` (empty): under ADR-17 Option A the operator
    /// dimension's CHOICES are ALREADY the constraint-pruned survivor set — `_mutex_`/`_requires_`/
    /// `_exclude_` are applied during sequence-build (`expand_or_generator_sequences` /
    /// `expand_cartesian_generator_sequences`), so each surviving multi-operator sequence becomes one
    /// constraint-free choice. The model therefore stays a single, constraint-free dimension and the
    /// existing prune/score/refit path works unchanged.
    pub fn generation_spec(&self) -> GenerationSpec {
        GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![self.dimension.clone()],
            max_variants: Some(self.dimension.choices.len()),
            constraints: GenerationConstraints::default(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VariantPlan {
    pub variant_id: VariantId,
    #[serde(default)]
    pub choices: BTreeMap<String, GenerationChoice>,
    pub fingerprint: String,
    pub seed: Option<u64>,
}

impl VariantPlan {
    pub fn validate(&self) -> Result<()> {
        if self.fingerprint.trim().is_empty() {
            return Err(DagMlError::Planning(format!(
                "variant `{}` has an empty fingerprint",
                self.variant_id
            )));
        }
        for (dimension_name, choice) in &self.choices {
            choice.validate(dimension_name)?;
        }
        self.param_overrides_by_node()?;
        Ok(())
    }

    pub fn effective_params_for_node(
        &self,
        node_id: &NodeId,
        base_params: &BTreeMap<String, serde_json::Value>,
    ) -> Result<BTreeMap<String, serde_json::Value>> {
        let overrides_by_node = self.param_overrides_by_node()?;
        let Some(overrides) = overrides_by_node.get(node_id) else {
            return Ok(base_params.clone());
        };
        let mut params = base_params.clone();
        params.extend(overrides.clone());
        Ok(params)
    }

    pub fn param_override_targets(&self) -> Result<BTreeSet<NodeId>> {
        Ok(self.param_overrides_by_node()?.into_keys().collect())
    }

    fn param_overrides_by_node(
        &self,
    ) -> Result<BTreeMap<NodeId, BTreeMap<String, serde_json::Value>>> {
        let mut overrides = BTreeMap::<NodeId, BTreeMap<String, serde_json::Value>>::new();
        let mut owners = BTreeMap::<(NodeId, String), String>::new();
        for (dimension_name, choice) in &self.choices {
            for override_spec in &choice.param_overrides {
                for (param_key, value) in &override_spec.params {
                    let owner_key = (override_spec.node_id.clone(), param_key.clone());
                    if let Some(previous) =
                        owners.insert(owner_key, format!("{dimension_name}:{}", choice.label))
                    {
                        return Err(DagMlError::CampaignValidation(format!(
                            "variant `{}` has conflicting generation overrides for `{}.{}` from `{previous}` and `{}:{}`",
                            self.variant_id,
                            override_spec.node_id,
                            param_key,
                            dimension_name,
                            choice.label
                        )));
                    }
                    overrides
                        .entry(override_spec.node_id.clone())
                        .or_default()
                        .insert(param_key.clone(), value.clone());
                }
            }
        }
        Ok(overrides)
    }
}

pub fn enumerate_variants(
    spec: &GenerationSpec,
    root_seed: Option<u64>,
) -> Result<Vec<VariantPlan>> {
    spec.validate()?;
    let mut variants = match spec.strategy {
        GenerationStrategy::None => vec![BTreeMap::new()],
        GenerationStrategy::Cartesian => cartesian_choices(&spec.dimensions),
        GenerationStrategy::Zip => zip_choices(&spec.dimensions),
    };
    if !spec.constraints.is_empty() {
        // Prune the enumerated cartesian/zip product BEFORE the max_variants check and before
        // materializing VariantPlans, so the surviving set (and its fingerprints/order) is exactly
        // the constraint-pruned set. `retain` is stable, so determinism/order is preserved.
        variants.retain(|choices| satisfies_constraints(choices, &spec.constraints));
        if variants.is_empty() {
            return Err(DagMlError::CampaignValidation(
                "generation constraints pruned every variant".to_string(),
            ));
        }
    }
    if let Some(max_variants) = spec.max_variants {
        if variants.len() > max_variants {
            return Err(DagMlError::CampaignValidation(format!(
                "generation produced {} variants, above max_variants={max_variants}",
                variants.len()
            )));
        }
    }

    variants
        .drain(..)
        .map(|choices| variant_from_choices(choices, root_seed))
        .collect()
}

/// The SHARED constraint-rule core: true when a candidate (identified ONLY through the `present`
/// membership predicate) violates none of the `constraints`. The rule logic — issubset-mutex,
/// implication-requires, forbidden-pair-exclude — is defined HERE ONCE; callers supply only "is ref X
/// present in this candidate" so a single rule core serves every candidate shape:
///
/// * [`satisfies_constraints`] (B's cartesian/zip variant pruning) passes a predicate that resolves a
///   [`ChoiceRef`] against the variant's `dimension -> selected choice` map;
/// * the operator-generator sequence-build prune (ADR-17 1a/1b) passes a predicate that resolves a
///   ref against the operator-class SET each merged multi-operator sequence selected.
///
/// This mirrors nirs4all's `_generator/constraints.py::apply_all_constraints` (mutex → requires →
/// exclude), each filter monotone over the input, so a single `retain` pass with this predicate is
/// order-equivalent to the legacy three sequential passes.
pub(crate) fn constraints_satisfied<F>(present: F, constraints: &GenerationConstraints) -> bool
where
    F: Fn(&ChoiceRef) -> bool,
{
    for group in &constraints.mutex {
        // nirs4all LEGACY mutex semantic (`_generator/constraints.py::_satisfies_mutex`,
        // `mutex_set.issubset(combo_set)`): a candidate is forbidden ONLY when EVERY member of
        // the group co-occurs in it ("not all co-occur"), not when merely two-or-more do. For a
        // PAIR (generator_or_pick_mutex 6->5) "all present" == "count > 1", so this
        // is byte-identical to the prior `count > 1` rule; the two DIVERGE only for groups of 3+,
        // where legacy forbids the SINGLE full-co-occurrence candidate and keeps every proper subset.
        if group.iter().all(&present) {
            return false;
        }
    }
    for (left, right) in &constraints.requires {
        if present(left) && !present(right) {
            return false;
        }
    }
    for (left, right) in &constraints.exclude {
        if present(left) && present(right) {
            return false;
        }
    }
    true
}

/// True when `choices` (a single variant's `dimension -> selected choice` map) violates none of the
/// `constraints`. A ref is "present" when the variant's choice for `ref.dimension` carries `ref.label`.
/// Delegates the rule logic to the shared [`constraints_satisfied`] core.
fn satisfies_constraints(
    choices: &BTreeMap<String, GenerationChoice>,
    constraints: &GenerationConstraints,
) -> bool {
    constraints_satisfied(
        |reference: &ChoiceRef| {
            choices
                .get(&reference.dimension)
                .is_some_and(|choice| choice.label == reference.label)
        },
        constraints,
    )
}

pub fn generation_spec_fingerprint(spec: &GenerationSpec) -> Result<String> {
    spec.validate()?;
    stable_json_fingerprint(spec)
}

fn cartesian_choices(
    dimensions: &[GenerationDimension],
) -> Vec<BTreeMap<String, GenerationChoice>> {
    let mut variants = vec![BTreeMap::new()];
    for dimension in dimensions {
        let mut next = Vec::with_capacity(variants.len() * dimension.choices.len());
        for existing in &variants {
            for choice in &dimension.choices {
                let mut merged = existing.clone();
                merged.insert(dimension.name.clone(), choice.clone());
                next.push(merged);
            }
        }
        variants = next;
    }
    variants
}

fn zip_choices(dimensions: &[GenerationDimension]) -> Vec<BTreeMap<String, GenerationChoice>> {
    let len = dimensions
        .first()
        .map_or(0, |dimension| dimension.choices.len());
    (0..len)
        .map(|idx| {
            dimensions
                .iter()
                .map(|dimension| (dimension.name.clone(), dimension.choices[idx].clone()))
                .collect::<BTreeMap<_, _>>()
        })
        .collect()
}

fn variant_from_choices(
    choices: BTreeMap<String, GenerationChoice>,
    root_seed: Option<u64>,
) -> Result<VariantPlan> {
    let fingerprint = stable_json_fingerprint(&choices)?;
    let suffix = if choices.is_empty() {
        "base".to_string()
    } else {
        fingerprint[..16].to_string()
    };
    let variant_id = VariantId::new(format!("variant:{suffix}"))?;
    let seed = root_seed.map(|seed| {
        SeedContext::root(seed)
            .child(format!("variant:{variant_id}"))
            .derive_u64("variant")
    });
    let variant = VariantPlan {
        variant_id,
        choices,
        fingerprint,
        seed,
    };
    variant.validate()?;
    Ok(variant)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn choice(label: &str, value: serde_json::Value) -> GenerationChoice {
        GenerationChoice {
            label: label.to_string(),
            value,
            param_overrides: Vec::new(),
            active_subsequence: None,
        }
    }

    fn override_choice(
        label: &str,
        node_id: &str,
        params: BTreeMap<String, serde_json::Value>,
    ) -> GenerationChoice {
        GenerationChoice {
            label: label.to_string(),
            value: json!(label),
            param_overrides: vec![GenerationParamOverride {
                node_id: NodeId::new(node_id).unwrap(),
                params,
            }],
            active_subsequence: None,
        }
    }

    #[test]
    fn default_generation_produces_base_variant() {
        let variants = enumerate_variants(&GenerationSpec::default(), Some(7)).unwrap();

        assert_eq!(variants.len(), 1);
        assert_eq!(variants[0].variant_id.as_str(), "variant:base");
        assert!(variants[0].choices.is_empty());
        assert!(variants[0].seed.is_some());
    }

    #[test]
    fn cartesian_generation_is_deterministic_and_fingerprinted() {
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![
                GenerationDimension {
                    name: "model".to_string(),
                    choices: vec![choice("pls", json!("pls")), choice("rf", json!("rf"))],
                },
                GenerationDimension {
                    name: "window".to_string(),
                    choices: vec![choice("short", json!(7)), choice("long", json!(21))],
                },
            ],
            max_variants: Some(4),
            constraints: GenerationConstraints::default(),
        };

        let left = enumerate_variants(&spec, Some(11)).unwrap();
        let right = enumerate_variants(&spec, Some(11)).unwrap();

        assert_eq!(left.len(), 4);
        assert_eq!(left, right);
        let fingerprint = generation_spec_fingerprint(&spec).unwrap();
        let mut changed_spec = spec.clone();
        changed_spec.dimensions[0].choices[0].value = json!("changed");
        assert_eq!(fingerprint, generation_spec_fingerprint(&spec).unwrap());
        assert_ne!(
            fingerprint,
            generation_spec_fingerprint(&changed_spec).unwrap()
        );
        assert_ne!(left[0].variant_id, left[1].variant_id);
        assert_eq!(left[0].choices["model"].label, "pls");
        assert_eq!(left[0].choices["window"].label, "short");
    }

    /// Phase 2 byte-identity gate for the additive `active_subsequence` / `variant_label` fields.
    ///
    /// The committed example specs/fixtures carry NEITHER new field, so `skip_serializing_if =
    /// "Option::is_none"` must keep them invisible: the structs round-trip to byte-identical JSON
    /// and produce byte-identical fingerprints (`generation_spec_fingerprint` /
    /// `stable_json_fingerprint`) as before the struct change. The fingerprints are pinned to the
    /// values produced before the fields existed, proving pure additivity / zero behavior change.
    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn additive_variant_fields_are_invisible_when_absent() {
        // `examples/campaign_oof_generation.json` — a CampaignSpec whose `generation` block is a
        // value-only cartesian search (no param_overrides, no active_subsequence on any choice).
        let campaign: crate::plan::CampaignSpec = serde_json::from_str(include_str!(
            "../../../examples/campaign_oof_generation.json"
        ))
        .unwrap();
        let generation_serialized = serde_json::to_string(&campaign.generation).unwrap();
        assert!(
            !generation_serialized.contains("active_subsequence"),
            "absent active_subsequence must not serialize: {generation_serialized}"
        );
        // Fingerprint pinned to the pre-field value: unchanged proves the new field is invisible.
        assert_eq!(
            generation_spec_fingerprint(&campaign.generation).unwrap(),
            "8d10bce07876d936ab6a62f13063a8d241c967a1578b6d2295a43c26275edf47"
        );

        // `examples/fixtures/score_set.json` — a ScoreSet whose reports carry no variant_label
        // (one report carries a variant_id, none carry variant_label).
        let score_set: crate::metrics::ScoreSet =
            serde_json::from_str(include_str!("../../../examples/fixtures/score_set.json"))
                .unwrap();
        let score_set_serialized = serde_json::to_string(&score_set).unwrap();
        assert!(
            !score_set_serialized.contains("variant_label"),
            "absent variant_label must not serialize: {score_set_serialized}"
        );
        assert_eq!(
            stable_json_fingerprint(&score_set).unwrap(),
            "e99fa78d79ef2a2b99927276cfaf4c265210abf3cf8b3575477355264fda4a9d"
        );
    }

    #[test]
    fn choice_cannot_set_both_param_overrides_and_active_subsequence() {
        let choice = GenerationChoice {
            label: "both".to_string(),
            value: json!("both"),
            param_overrides: vec![GenerationParamOverride {
                node_id: NodeId::new("model:base").unwrap(),
                params: BTreeMap::from([("n_components".to_string(), json!(4))]),
            }],
            active_subsequence: Some("alt".to_string()),
        };
        let error = choice.validate("dim").unwrap_err().to_string();
        assert!(
            error.contains("cannot set both param_overrides and active_subsequence"),
            "{error}"
        );

        // Only-param_overrides (existing param variant) stays legal.
        let param_only = GenerationChoice {
            active_subsequence: None,
            ..choice.clone()
        };
        param_only.validate("dim").unwrap();

        // Only-active_subsequence (operator variant) stays legal.
        let operator_only = GenerationChoice {
            param_overrides: Vec::new(),
            ..choice.clone()
        };
        operator_only.validate("dim").unwrap();

        // Neither (value-only) stays legal.
        let value_only = GenerationChoice {
            param_overrides: Vec::new(),
            active_subsequence: None,
            ..choice
        };
        value_only.validate("dim").unwrap();
    }

    #[test]
    fn choice_rejects_empty_active_subsequence() {
        // The schema (minLength:1) and both Python validator paths require a non-empty
        // active_subsequence; the Rust validate must reject empty/whitespace identically so
        // CampaignSpec/ExecutionPlan validation does not accept a contract shape they reject.
        for blank in ["", "   "] {
            let choice = GenerationChoice {
                label: "op".to_string(),
                value: json!("op"),
                param_overrides: Vec::new(),
                active_subsequence: Some(blank.to_string()),
            };
            let error = choice.validate("dim").unwrap_err().to_string();
            assert!(error.contains("has an empty active_subsequence"), "{error}");
        }
    }

    #[test]
    fn zip_generation_requires_same_choice_count() {
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Zip,
            dimensions: vec![
                GenerationDimension {
                    name: "a".to_string(),
                    choices: vec![choice("a1", json!(1))],
                },
                GenerationDimension {
                    name: "b".to_string(),
                    choices: vec![choice("b1", json!(1)), choice("b2", json!(2))],
                },
            ],
            max_variants: None,
            constraints: GenerationConstraints::default(),
        };

        assert!(spec.validate().is_err());
    }

    #[test]
    fn generation_respects_variant_limit() {
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![GenerationDimension {
                name: "x".to_string(),
                choices: vec![choice("a", json!(1)), choice("b", json!(2))],
            }],
            max_variants: Some(1),
            constraints: GenerationConstraints::default(),
        };

        assert!(enumerate_variants(&spec, None).is_err());
    }

    #[test]
    fn variant_applies_node_param_overrides() {
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![GenerationDimension {
                name: "model_family".to_string(),
                choices: vec![override_choice(
                    "pls",
                    "model:base",
                    BTreeMap::from([("n_components".to_string(), json!(8))]),
                )],
            }],
            max_variants: Some(1),
            constraints: GenerationConstraints::default(),
        };
        let variants = enumerate_variants(&spec, Some(7)).unwrap();
        let base = BTreeMap::from([("scale".to_string(), json!(true))]);

        let params = variants[0]
            .effective_params_for_node(&NodeId::new("model:base").unwrap(), &base)
            .unwrap();

        assert_eq!(params["scale"], json!(true));
        assert_eq!(params["n_components"], json!(8));
    }

    #[test]
    fn variant_rejects_conflicting_param_overrides() {
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![
                GenerationDimension {
                    name: "family".to_string(),
                    choices: vec![override_choice(
                        "pls",
                        "model:base",
                        BTreeMap::from([("alpha".to_string(), json!(1))]),
                    )],
                },
                GenerationDimension {
                    name: "regularization".to_string(),
                    choices: vec![override_choice(
                        "ridge",
                        "model:base",
                        BTreeMap::from([("alpha".to_string(), json!(2))]),
                    )],
                },
            ],
            max_variants: Some(1),
            constraints: GenerationConstraints::default(),
        };

        let error = enumerate_variants(&spec, None).unwrap_err().to_string();

        assert!(error.contains("conflicting generation overrides"));
    }

    // -------------------------------------------------------------------------
    // Generation CONSTRAINTS (item B): native `mutex` / `requires` / `exclude`
    // pruning. The survivor COUNTS are pinned to the nirs4all generation oracle's
    // documented locks (`tests/integration/parity/cases_generators_conformance.py`
    // + `test_generators_conformance_extra._CONSTRAINT_SURVIVORS`):
    //   mutex 6 -> 5, requires 6 -> 4, exclude 6 -> 5, cartesian_exclude 4 -> 3,
    //   combined (mutex + exclude) 6 -> 4, prunes-to-one -> 1.
    // dag-ml reproduces those COUNTS natively over its own dimension model (one
    // choice per dimension, cross-dimension co-occurrence pruning); the host
    // translation of operator-combination semantics into these constraints is the
    // separate follow-on, out of scope here.
    // -------------------------------------------------------------------------

    fn cref(dimension: &str, label: &str) -> ChoiceRef {
        ChoiceRef {
            dimension: dimension.to_string(),
            label: label.to_string(),
        }
    }

    /// A 2x3 cartesian (6 pre-prune variants): dim `a` in {a1, a2}, dim `b` in {b1, b2, b3}.
    fn two_by_three_dimensions() -> Vec<GenerationDimension> {
        vec![
            GenerationDimension {
                name: "a".to_string(),
                choices: vec![choice("a1", json!("a1")), choice("a2", json!("a2"))],
            },
            GenerationDimension {
                name: "b".to_string(),
                choices: vec![
                    choice("b1", json!("b1")),
                    choice("b2", json!("b2")),
                    choice("b3", json!("b3")),
                ],
            },
        ]
    }

    /// The survivor set as sorted `(dimension, label)` pairs per variant — the member-level lock
    /// (not just the count), so a wrong-prune with the right count still fails.
    fn survivor_signatures(variants: &[VariantPlan]) -> Vec<Vec<(String, String)>> {
        variants
            .iter()
            .map(|variant| {
                variant
                    .choices
                    .iter()
                    .map(|(dimension, choice)| (dimension.clone(), choice.label.clone()))
                    .collect()
            })
            .collect()
    }

    #[test]
    fn constraint_mutex_prunes_pair() {
        // mutex [[a:a1, b:b1]]: the single {a1, b1} variant is removed -> 6 - 1 = 5.
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: two_by_three_dimensions(),
            max_variants: Some(6),
            constraints: GenerationConstraints {
                mutex: vec![vec![cref("a", "a1"), cref("b", "b1")]],
                ..GenerationConstraints::default()
            },
        };
        let variants = enumerate_variants(&spec, Some(11)).unwrap();
        assert_eq!(variants.len(), 5);
        let signatures = survivor_signatures(&variants);
        assert!(!signatures.contains(&vec![
            ("a".to_string(), "a1".to_string()),
            ("b".to_string(), "b1".to_string())
        ]));
        // The pruned set is deterministic + fingerprinted across calls.
        assert_eq!(variants, enumerate_variants(&spec, Some(11)).unwrap());
    }

    #[test]
    fn constraint_requires_prunes() {
        // requires (a:a1 -> b:b1): variants with a1 but not b1 ({a1,b2}, {a1,b3}) drop -> 6 - 2 = 4.
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: two_by_three_dimensions(),
            max_variants: Some(6),
            constraints: GenerationConstraints {
                requires: vec![(cref("a", "a1"), cref("b", "b1"))],
                ..GenerationConstraints::default()
            },
        };
        let variants = enumerate_variants(&spec, None).unwrap();
        assert_eq!(variants.len(), 4);
        let signatures = survivor_signatures(&variants);
        // a1 survives only paired with b1.
        for signature in &signatures {
            if signature.contains(&("a".to_string(), "a1".to_string())) {
                assert!(signature.contains(&("b".to_string(), "b1".to_string())));
            }
        }
    }

    #[test]
    fn constraint_exclude_prunes_pair() {
        // exclude (a:a1, b:b1): the {a1, b1} variant is forbidden -> 6 - 1 = 5.
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: two_by_three_dimensions(),
            max_variants: Some(6),
            constraints: GenerationConstraints {
                exclude: vec![(cref("a", "a1"), cref("b", "b1"))],
                ..GenerationConstraints::default()
            },
        };
        let variants = enumerate_variants(&spec, None).unwrap();
        assert_eq!(variants.len(), 5);
        assert!(!survivor_signatures(&variants).contains(&vec![
            ("a".to_string(), "a1".to_string()),
            ("b".to_string(), "b1".to_string())
        ]));
    }

    #[test]
    fn constraint_cartesian_exclude_prunes_one_of_four() {
        // 2x2 cartesian (4 variants); exclude one pair -> 3, mirroring the oracle's
        // `generator_cartesian_exclude` 4 -> 3 lock.
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![
                GenerationDimension {
                    name: "a".to_string(),
                    choices: vec![choice("a1", json!("a1")), choice("a2", json!("a2"))],
                },
                GenerationDimension {
                    name: "b".to_string(),
                    choices: vec![choice("b1", json!("b1")), choice("b2", json!("b2"))],
                },
            ],
            max_variants: Some(4),
            constraints: GenerationConstraints {
                exclude: vec![(cref("a", "a1"), cref("b", "b1"))],
                ..GenerationConstraints::default()
            },
        };
        let variants = enumerate_variants(&spec, None).unwrap();
        assert_eq!(variants.len(), 3);
    }

    #[test]
    fn constraint_combined_mutex_and_exclude() {
        // Two constraint kinds on one spec: mutex removes {a1,b1}, exclude removes {a2,b2}
        // -> 6 - 1 - 1 = 4 (the oracle's combined `_mutex_` + `_exclude_` 6 -> 4 lock shape).
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: two_by_three_dimensions(),
            max_variants: Some(6),
            constraints: GenerationConstraints {
                mutex: vec![vec![cref("a", "a1"), cref("b", "b1")]],
                exclude: vec![(cref("a", "a2"), cref("b", "b2"))],
                ..GenerationConstraints::default()
            },
        };
        let variants = enumerate_variants(&spec, None).unwrap();
        assert_eq!(variants.len(), 4);
        let signatures = survivor_signatures(&variants);
        assert!(!signatures.contains(&vec![
            ("a".to_string(), "a1".to_string()),
            ("b".to_string(), "b1".to_string())
        ]));
        assert!(!signatures.contains(&vec![
            ("a".to_string(), "a2".to_string()),
            ("b".to_string(), "b2".to_string())
        ]));
    }

    #[test]
    fn constraint_mutex_group_of_three_forbids_only_full_co_occurrence() {
        // A SIZE-3 mutex group [a:a1, b:b1, c:c1] over a 2x2x2 cartesian (8 variants). This is where
        // the "not all co-occur" (legacy `issubset`) rule DIVERGES from the old "<=1 present" rule:
        //   - legacy "not all co-occur" forbids ONLY the single {a1,b1,c1} variant       -> 8 - 1 = 7
        //   - the old "count > 1" rule would forbid EVERY variant with 2+ of {a1,b1,c1}  -> only 4
        // We lock 7 survivors with {a1,b1,c1} as the SOLE casualty, matching the nirs4all generation
        // oracle (`generator_or_pick_mutex3`): a >2 mutex prunes exactly the all-present combination
        // and keeps every proper subset. (For a PAIR the two rules coincide — see the cases above.)
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![
                GenerationDimension {
                    name: "a".to_string(),
                    choices: vec![choice("a1", json!("a1")), choice("a2", json!("a2"))],
                },
                GenerationDimension {
                    name: "b".to_string(),
                    choices: vec![choice("b1", json!("b1")), choice("b2", json!("b2"))],
                },
                GenerationDimension {
                    name: "c".to_string(),
                    choices: vec![choice("c1", json!("c1")), choice("c2", json!("c2"))],
                },
            ],
            max_variants: Some(8),
            constraints: GenerationConstraints {
                mutex: vec![vec![cref("a", "a1"), cref("b", "b1"), cref("c", "c1")]],
                ..GenerationConstraints::default()
            },
        };
        let variants = enumerate_variants(&spec, None).unwrap();
        assert_eq!(variants.len(), 7);
        let signatures = survivor_signatures(&variants);
        // The all-present {a1,b1,c1} variant is the ONLY casualty.
        let all_present = vec![
            ("a".to_string(), "a1".to_string()),
            ("b".to_string(), "b1".to_string()),
            ("c".to_string(), "c1".to_string()),
        ];
        assert!(!signatures.contains(&all_present));
        // Every PROPER subset of the mutex group survives (would be wrongly pruned by "count > 1"):
        // exactly-two-present variants {a1,b1,c2}, {a1,b2,c1}, {a2,b1,c1} are all retained.
        for retained in [
            vec![
                ("a".to_string(), "a1".to_string()),
                ("b".to_string(), "b1".to_string()),
                ("c".to_string(), "c2".to_string()),
            ],
            vec![
                ("a".to_string(), "a1".to_string()),
                ("b".to_string(), "b2".to_string()),
                ("c".to_string(), "c1".to_string()),
            ],
            vec![
                ("a".to_string(), "a2".to_string()),
                ("b".to_string(), "b1".to_string()),
                ("c".to_string(), "c1".to_string()),
            ],
        ] {
            assert!(
                signatures.contains(&retained),
                "proper subset {retained:?} was wrongly pruned"
            );
        }
        // Deterministic + fingerprinted across calls.
        assert_eq!(variants, enumerate_variants(&spec, None).unwrap());
    }

    #[test]
    fn constraint_prunes_to_one() {
        // Two mutex pairs prune the 2x3 product down to a single survivor, mirroring the oracle's
        // `generator_constraint_prunes_to_one` lock. a1 is mutex with both b1 and b2; a2 is mutex
        // with all of b1/b2/b3. Survivors: {a1,b3} only.
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: two_by_three_dimensions(),
            max_variants: Some(6),
            constraints: GenerationConstraints {
                mutex: vec![
                    vec![cref("a", "a1"), cref("b", "b1")],
                    vec![cref("a", "a1"), cref("b", "b2")],
                    vec![cref("a", "a2"), cref("b", "b1")],
                    vec![cref("a", "a2"), cref("b", "b2")],
                    vec![cref("a", "a2"), cref("b", "b3")],
                ],
                ..GenerationConstraints::default()
            },
        };
        let variants = enumerate_variants(&spec, None).unwrap();
        assert_eq!(variants.len(), 1);
        assert_eq!(
            survivor_signatures(&variants),
            vec![vec![
                ("a".to_string(), "a1".to_string()),
                ("b".to_string(), "b3".to_string())
            ]]
        );
    }

    #[test]
    fn constraint_all_pruned_is_an_error() {
        // exclude removes a1-with-b*, mutex removes a2-with-b* -> no survivors -> error.
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![
                GenerationDimension {
                    name: "a".to_string(),
                    choices: vec![choice("a1", json!("a1"))],
                },
                GenerationDimension {
                    name: "b".to_string(),
                    choices: vec![choice("b1", json!("b1"))],
                },
            ],
            max_variants: Some(1),
            constraints: GenerationConstraints {
                exclude: vec![(cref("a", "a1"), cref("b", "b1"))],
                ..GenerationConstraints::default()
            },
        };
        let error = enumerate_variants(&spec, None).unwrap_err().to_string();
        assert!(error.contains("pruned every variant"), "{error}");
    }

    #[test]
    fn constraint_unknown_choice_is_rejected() {
        let spec = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: two_by_three_dimensions(),
            max_variants: Some(6),
            constraints: GenerationConstraints {
                mutex: vec![vec![cref("a", "a1"), cref("b", "nope")]],
                ..GenerationConstraints::default()
            },
        };
        let error = spec.validate().unwrap_err().to_string();
        assert!(error.contains("unknown choice `b:nope`"), "{error}");
    }

    #[test]
    fn constraints_require_a_strategy() {
        let spec = GenerationSpec {
            strategy: GenerationStrategy::None,
            dimensions: Vec::new(),
            max_variants: Some(1),
            constraints: GenerationConstraints {
                exclude: vec![(cref("a", "a1"), cref("b", "b1"))],
                ..GenerationConstraints::default()
            },
        };
        let error = spec.validate().unwrap_err().to_string();
        assert!(
            error.contains("constraints require cartesian or zip"),
            "{error}"
        );
    }

    #[test]
    fn constraints_absent_keep_spec_byte_identical() {
        // A no-constraint spec must serialize without a `constraints` key and fingerprint exactly
        // as it would before this field existed (additivity proof, parallel to the Phase-2 gate).
        let with_default = GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: two_by_three_dimensions(),
            max_variants: Some(6),
            constraints: GenerationConstraints::default(),
        };
        let serialized = serde_json::to_string(&with_default).unwrap();
        assert!(
            !serialized.contains("constraints"),
            "absent constraints must not serialize: {serialized}"
        );
        // Round-trips through a constraint-less JSON shape identically.
        let reparsed: GenerationSpec = serde_json::from_str(
            r#"{"strategy":"cartesian","dimensions":[{"name":"a","choices":[{"label":"a1","value":"a1"},{"label":"a2","value":"a2"}]},{"name":"b","choices":[{"label":"b1","value":"b1"},{"label":"b2","value":"b2"},{"label":"b3","value":"b3"}]}],"max_variants":6}"#,
        )
        .unwrap();
        assert_eq!(
            generation_spec_fingerprint(&with_default).unwrap(),
            generation_spec_fingerprint(&reparsed).unwrap()
        );
        assert!(reparsed.constraints.is_empty());
    }
}
