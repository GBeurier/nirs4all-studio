#!/usr/bin/env bash
# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
#
# Strict local/CI command for the IO -> dag-ml-data cross-CLI conformance gate.
# It reuses tests/dag_ml_data/verify_cross_cli.sh but forces missing external
# CLIs to be a hard failure instead of a developer-convenience skip.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace_root="$(cd "${repo_root}/.." && pwd)"

default_dmd="${workspace_root}/dag-ml-data"
default_dml="${workspace_root}/dag-ml"
if [[ -d "${workspace_root}/INT-dmd" ]]; then
  default_dmd="${workspace_root}/INT-dmd"
fi
if [[ -d "${workspace_root}/INT-dagml" ]]; then
  default_dml="${workspace_root}/INT-dagml"
fi

export NIRS4ALL_DAG_ML_DATA="${NIRS4ALL_DAG_ML_DATA:-${default_dmd}}"
export NIRS4ALL_DAG_ML="${NIRS4ALL_DAG_ML:-${default_dml}}"
export NIRS4ALL_REQUIRE_DAGML_SIBLINGS="${NIRS4ALL_REQUIRE_DAGML_SIBLINGS:-1}"

echo ">> strict IO -> dag-ml-data cross-CLI conformance"
echo "   nirs4all-io: ${repo_root}"
echo "   dag-ml-data: ${NIRS4ALL_DAG_ML_DATA}"
echo "   dag-ml:      ${NIRS4ALL_DAG_ML}"

exec bash "${repo_root}/tests/dag_ml_data/verify_cross_cli.sh" "$@"
