// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! `emit-dagml`: load an input, assemble it, and emit a dag-ml-data
//! `CoordinatorDataPlanEnvelope` as JSON (EPIC 10). The dag-ml-data emit lives in
//! this bridge crate so the published `nirs4all-io` CLI does not grow a hard
//! dag-ml-data dependency.

use anyhow::{anyhow, Result};
use clap::Parser;

use nirs4all_io::api::{load_assembled, Input};
use nirs4all_io_dagml::{to_dataset_package, PackageProvider};

#[derive(Parser)]
#[command(
    name = "emit-dagml",
    about = "Emit a dag-ml-data CoordinatorDataPlanEnvelope as JSON"
)]
struct Cli {
    /// Data path(s) to resolve via conventions (1 → Path, several → file list).
    #[arg(required = true)]
    inputs: Vec<String>,
    /// Convention profile to match (repeatable). Default: nirs4all-classic.
    #[arg(long = "convention", short = 'c')]
    conventions: Vec<String>,
    /// Override the dataset name.
    #[arg(long)]
    name: Option<String>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let input = if cli.inputs.len() == 1 {
        Input::Path(cli.inputs[0].clone())
    } else {
        Input::Paths(cli.inputs.clone())
    };
    let conv = if cli.conventions.is_empty() {
        None
    } else {
        Some(cli.conventions.as_slice())
    };
    let assembled =
        load_assembled(&input, conv, cli.name.as_deref()).map_err(|e| anyhow!(e.message))?;
    let package = to_dataset_package(&assembled);
    let provider = PackageProvider::from_package(&package).map_err(|e| anyhow!(e.message))?;
    println!("{}", serde_json::to_string_pretty(provider.envelope())?);
    Ok(())
}
