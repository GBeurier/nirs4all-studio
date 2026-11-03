//! Host option adaptation to native variant enumeration and seeded sampling.

use dag_ml_core::{
    GenerationChoice, GenerationConstraints, GenerationDimension, GenerationSpec,
    GenerationStrategy,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    strategy: String,
    choices: BTreeMap<String, Vec<Value>>,
    #[serde(default)]
    constraints: GenerationConstraints,
    #[serde(default)]
    count: Option<usize>,
    #[serde(default)]
    seed: u64,
    #[serde(default = "limit")]
    max_variants: usize,
}

fn limit() -> usize {
    10_000
}

/// Generate exact native VariantPlans from user choices, including array shapes.
/// Constraints use native `{dimension, label:"choice:N"}` references.
pub fn generate_variants_json(input: &str) -> Result<String, String> {
    let request: Request = serde_json::from_str(input).map_err(|error| error.to_string())?;
    let strategy = match request.strategy.as_str() {
        "cartesian" | "random" => GenerationStrategy::Cartesian,
        "zip" => GenerationStrategy::Zip,
        _ => return Err("strategy must be cartesian, zip or random".into()),
    };
    let spec = GenerationSpec {
        strategy,
        max_variants: Some(request.max_variants),
        constraints: request.constraints,
        dimensions: request
            .choices
            .into_iter()
            .map(|(name, values)| GenerationDimension {
                name,
                choices: values
                    .into_iter()
                    .enumerate()
                    .map(|(index, value)| GenerationChoice {
                        label: format!("choice:{index}"),
                        value,
                        param_overrides: vec![],
                        active_subsequence: None,
                    })
                    .collect(),
            })
            .collect(),
    };
    let variants = if request.strategy == "random" {
        dag_ml_core::generation::sample_generation_variants(
            &spec,
            request.seed,
            request.count.ok_or("random generation requires count")?,
        )
    } else {
        if request.count.is_some() {
            return Err("count is used only for random generation".into());
        }
        dag_ml_core::enumerate_variants(&spec, Some(request.seed))
    }
    .map_err(|error| error.to_string())?;
    serde_json::to_string(&variants).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constrained_shaped_random_choices_keep_native_identities() {
        let request = serde_json::json!({"strategy":"cartesian", "seed":17,
            "choices":{"shape":[[2,3],[4,5]],"selection":["one","two"]},
            "constraints":{"exclude":[[{"dimension":"shape","label":"choice:1"},
                {"dimension":"selection","label":"choice:1"}]]}});
        let all: Vec<Value> =
            serde_json::from_str(&generate_variants_json(&request.to_string()).unwrap()).unwrap();
        assert_eq!(all.len(), 3);
        let mut random = request.clone();
        random["strategy"] = "random".into();
        random["count"] = 2.into();
        let result = generate_variants_json(&random.to_string()).unwrap();
        assert_eq!(result, generate_variants_json(&random.to_string()).unwrap());
        let sampled: Vec<Value> = serde_json::from_str(&result).unwrap();
        assert_eq!(sampled.len(), 2);
        assert!(sampled.iter().all(|variant| all.contains(variant)));
        random["count"] = 4.into();
        assert!(generate_variants_json(&random.to_string()).is_err());
    }
}
