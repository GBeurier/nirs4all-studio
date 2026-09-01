// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Command-line front end for `nirs4all-io`.
//!
//! Thin wrapper over the facade: every subcommand maps onto a single facade
//! call and prints the canonical JSON it returns (2-space, sorted keys,
//! trailing newline — identical to the C ABI / Python surface). `infer` uses
//! role inference; `to-spec` / `load` use the convention path; `emit-dag-ml-data`
//! points callers at the `nirs4all-io-dagml` bridge crate.

use anyhow::{anyhow, bail, Context, Result};
use clap::{Parser, Subcommand};

use nirs4all_io::api::{load_assembled, to_spec, Input};
use nirs4all_io::canonical_json;
use nirs4all_io::core::spec::{validate_spec, DatasetSpec};
use nirs4all_io::infer::{infer_path, infer_paths};
use serde_json::Value;

#[derive(Parser)]
#[command(name = "nirs4all-io", version, about = "Dataset-assembly bridge CLI")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Inspect input(s) and emit a scored DatasetPlan as JSON.
    Infer {
        /// Data path(s): directory, file, or glob. Multiple → file-list inference.
        #[arg(required = true)]
        inputs: Vec<String>,
        /// Convention profile to match (repeatable). Default: nirs4all-classic.
        #[arg(long = "convention", short = 'c')]
        conventions: Vec<String>,
    },
    /// Normalize input(s) into a canonical DatasetSpec as JSON.
    ToSpec {
        /// Data path(s) to resolve via conventions.
        #[arg(required_unless_present = "spec")]
        inputs: Vec<String>,
        /// Convention profile to match (repeatable). Default: nirs4all-classic.
        #[arg(long = "convention", short = 'c')]
        conventions: Vec<String>,
        /// Override the dataset name.
        #[arg(long)]
        name: Option<String>,
        /// Normalize a spec/config dict from this JSON file instead of paths.
        #[arg(long)]
        spec: Option<String>,
    },
    /// Validate a DatasetSpec JSON file (exit non-zero on error).
    Validate {
        /// Path to a DatasetSpec JSON file.
        input: String,
    },
    /// Materialize input(s) and emit the assembled-dataset summary as JSON.
    Load {
        /// Data path(s) to resolve via conventions.
        #[arg(required = true)]
        inputs: Vec<String>,
        /// Convention profile to match (repeatable). Default: nirs4all-classic.
        #[arg(long = "convention", short = 'c')]
        conventions: Vec<String>,
        /// Override the dataset name.
        #[arg(long)]
        name: Option<String>,
    },
    /// Point to the dag-ml-data bridge crate that emits CoordinatorDataPlanEnvelope JSON.
    EmitDagMlData {
        /// Data path(s) to resolve via conventions.
        #[arg(required = true)]
        inputs: Vec<String>,
        /// Convention profile to match (repeatable). Default: nirs4all-classic.
        #[arg(long = "convention", short = 'c')]
        conventions: Vec<String>,
        /// Override the dataset name.
        #[arg(long)]
        name: Option<String>,
    },
}

/// One path → `Path`, several → `Paths` (mirrors `api.py`'s dispatch).
fn make_input(inputs: &[String]) -> Input {
    if inputs.len() == 1 {
        Input::Path(inputs[0].clone())
    } else {
        Input::Paths(inputs.to_vec())
    }
}

fn conv_opt(conventions: &[String]) -> Option<&[String]> {
    if conventions.is_empty() {
        None
    } else {
        Some(conventions)
    }
}

/// Emit a canonical-JSON value to stdout (it already carries its trailing newline).
fn emit(value: &Value) -> Result<()> {
    print!("{}", canonical_json(value)?);
    Ok(())
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Infer {
            inputs,
            conventions,
        } => {
            let conv = conv_opt(&conventions);
            let plan = if inputs.len() == 1 {
                infer_path(&inputs[0], conv)
            } else {
                infer_paths(&inputs, conv)
            }
            .map_err(|e| anyhow!(e.message))?;
            emit(&plan.to_value())
        }
        Command::ToSpec {
            inputs,
            conventions,
            name,
            spec,
        } => {
            let input = match spec {
                Some(spec_file) => {
                    let text = std::fs::read_to_string(&spec_file)
                        .with_context(|| format!("read spec file {spec_file}"))?;
                    let value: Value = serde_json::from_str(&text)
                        .with_context(|| format!("parse spec JSON {spec_file}"))?;
                    Input::Spec(value)
                }
                None => make_input(&inputs),
            };
            let (spec, _base) = to_spec(&input, conv_opt(&conventions), name.as_deref())
                .map_err(|e| anyhow!(e.message))?;
            emit(&spec.to_value())
        }
        Command::Validate { input } => {
            let text = std::fs::read_to_string(&input).with_context(|| format!("read {input}"))?;
            let value: Value =
                serde_json::from_str(&text).with_context(|| format!("parse JSON {input}"))?;
            let spec = DatasetSpec::from_value(&value).map_err(|e| anyhow!(e.message))?;
            validate_spec(&spec).map_err(|e| anyhow!(e.message))?;
            eprintln!("valid: {input}");
            Ok(())
        }
        Command::Load {
            inputs,
            conventions,
            name,
        } => {
            let assembled = load_assembled(
                &make_input(&inputs),
                conv_opt(&conventions),
                name.as_deref(),
            )
            .map_err(|e| anyhow!(e.message))?;
            emit(&assembled.to_summary_value())
        }
        // The emit bridge lives in its own publish=false crate so the published
        // `nirs4all-io` CLI does not grow a hard dag-ml-data dependency.
        Command::EmitDagMlData { .. } => bail!(
            "emit-dag-ml-data lives in the bridge crate `nirs4all-io-dagml`. Run it from this checkout: \
             `cargo run --manifest-path crates/nirs4all-io-dagml/Cargo.toml --bin emit-dagml -- <input>`"
        ),
    }
}
