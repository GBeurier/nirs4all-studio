use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use dag_ml_data_core::{
    data_plan_fingerprint, plan_model_input, representation_registry, sample_relation_fingerprint,
    schema_fingerprint, validate_model_input_spec_against_registry, AdapterRegistry,
    AdapterRegistrySpec, CoordinatorDataMaterializationRequest, CoordinatorDataPlanEnvelope,
    CoordinatorHandleArena, DataPlan, DataPlanRequest, DatasetSchema, ModelInputSpec,
    SampleRelationTable, SourceId,
};

#[derive(Debug, Parser)]
#[command(author, version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    FingerprintSchema {
        path: PathBuf,
    },
    FingerprintPlan {
        path: PathBuf,
    },
    FingerprintRelations {
        path: PathBuf,
    },
    EnvelopePlan {
        #[arg(long)]
        schema: PathBuf,
        #[arg(long)]
        plan: PathBuf,
        #[arg(long)]
        relations: Option<PathBuf>,
    },
    ValidateEnvelope {
        path: PathBuf,
    },
    MaterializeEnvelope {
        #[arg(long)]
        envelope: PathBuf,
        #[arg(long)]
        request: PathBuf,
        #[arg(long, default_value = "controller:data.provider")]
        owner: String,
    },
    PlanModelInput {
        #[arg(long)]
        schema: PathBuf,
        #[arg(long)]
        model_input: PathBuf,
        #[arg(long)]
        adapters: PathBuf,
        #[arg(long)]
        id: String,
        #[arg(long = "source")]
        sources: Vec<String>,
    },
    /// Validate a `ModelInputSpec` / controller data-requirements fixture
    /// against the frozen built-in representation registry.
    ValidateModelInput {
        #[arg(long)]
        model_input: PathBuf,
    },
    /// Print the frozen, published built-in representation registry
    /// (`B-014`/`DMD-001`); the output is the
    /// `docs/contracts/representation_registry.v1.json` contract artifact.
    RepresentationRegistry,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Command::FingerprintSchema { path } => {
            let data = std::fs::read(&path)
                .with_context(|| format!("failed to read schema JSON at {}", path.display()))?;
            let schema: DatasetSchema = serde_json::from_slice(&data)
                .with_context(|| format!("failed to parse schema JSON at {}", path.display()))?;
            let fingerprint = schema_fingerprint(&schema)
                .with_context(|| format!("invalid schema at {}", path.display()))?;
            println!("{fingerprint}");
        }
        Command::FingerprintPlan { path } => {
            let plan: DataPlan = read_json(&path, "data plan")?;
            let fingerprint = data_plan_fingerprint(&plan)
                .with_context(|| format!("invalid data plan at {}", path.display()))?;
            println!("{fingerprint}");
        }
        Command::FingerprintRelations { path } => {
            let relations: SampleRelationTable = read_json(&path, "sample relations")?;
            let fingerprint = sample_relation_fingerprint(&relations)
                .with_context(|| format!("invalid sample relations at {}", path.display()))?;
            println!("{fingerprint}");
        }
        Command::EnvelopePlan {
            schema,
            plan,
            relations,
        } => {
            let schema: DatasetSchema = read_json(&schema, "schema")?;
            let plan: DataPlan = read_json(&plan, "data plan")?;
            let relations = relations
                .as_ref()
                .map(|path| read_json(path, "sample relations"))
                .transpose()?;
            let envelope =
                CoordinatorDataPlanEnvelope::from_parts(&schema, plan, relations.as_ref())
                    .context("failed to build coordinator data-plan envelope")?;
            println!("{}", serde_json::to_string_pretty(&envelope)?);
        }
        Command::ValidateEnvelope { path } => {
            let envelope: CoordinatorDataPlanEnvelope =
                read_json(&path, "coordinator data-plan envelope")?;
            envelope
                .validate()
                .with_context(|| format!("invalid data-plan envelope at {}", path.display()))?;
            println!(
                "valid data-plan envelope: plan_fingerprint={}, relations={}",
                envelope.plan_fingerprint,
                envelope
                    .coordinator_relations
                    .as_ref()
                    .map(|relations| relations.records.len())
                    .unwrap_or(0)
            );
        }
        Command::MaterializeEnvelope {
            envelope,
            request,
            owner,
        } => {
            let envelope: CoordinatorDataPlanEnvelope =
                read_json(&envelope, "coordinator data-plan envelope")?;
            let request: CoordinatorDataMaterializationRequest =
                read_json(&request, "coordinator data materialization request")?;
            let arena = CoordinatorHandleArena::new(owner)?;
            let record = arena
                .materialize(&envelope, &request)
                .with_context(|| "failed to materialize coordinator data handle")?;
            println!("{}", serde_json::to_string_pretty(&record)?);
        }
        Command::PlanModelInput {
            schema,
            model_input,
            adapters,
            id,
            sources,
        } => {
            let schema: DatasetSchema = read_json(&schema, "schema")?;
            let model_input: ModelInputSpec = read_json(&model_input, "model input")?;
            let registry_spec: AdapterRegistrySpec = read_json(&adapters, "adapter registry")?;
            let registry = AdapterRegistry::from_spec(registry_spec)
                .with_context(|| format!("invalid adapter registry at {}", adapters.display()))?;
            let plan = plan_model_input(
                &schema,
                &model_input,
                &registry,
                &DataPlanRequest {
                    id,
                    source_ids: (!sources.is_empty())
                        .then(|| {
                            sources
                                .into_iter()
                                .map(SourceId::new)
                                .collect::<dag_ml_data_core::Result<Vec<_>>>()
                        })
                        .transpose()?,
                    planning_policy: Default::default(),
                },
            )
            .context("failed to plan model input")?;
            println!("{}", serde_json::to_string_pretty(&plan)?);
        }
        Command::ValidateModelInput { model_input } => {
            let model_input_path = model_input;
            let model_input: ModelInputSpec = read_json(&model_input_path, "model input")?;
            validate_model_input_spec_against_registry(&model_input, &representation_registry())
                .with_context(|| {
                    format!(
                        "invalid model input against representation registry at {}",
                        model_input_path.display()
                    )
                })?;
            let accepted_count = model_input
                .ports
                .iter()
                .map(|port| port.accepted_representations.len())
                .sum::<usize>();
            println!(
                "valid model input: {} port(s), {} accepted representation(s)",
                model_input.ports.len(),
                accepted_count
            );
        }
        Command::RepresentationRegistry => {
            println!(
                "{}",
                serde_json::to_string_pretty(&representation_registry())?
            );
        }
    }

    Ok(())
}

fn read_json<T: serde::de::DeserializeOwned>(path: &PathBuf, label: &str) -> Result<T> {
    let data = std::fs::read(path)
        .with_context(|| format!("failed to read {label} JSON at {}", path.display()))?;
    serde_json::from_slice(&data)
        .with_context(|| format!("failed to parse {label} JSON at {}", path.display()))
}
