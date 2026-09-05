#!/usr/bin/env bash
# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
#
# EPIC 10.4 — cross-CLI conformance for the dag-ml-data emit.
#
# Proves that an io-emitted CoordinatorDataPlanEnvelope is accepted by BOTH
# ecosystem CLIs:
#   1. dag-ml-data-cli validate-envelope   (the full envelope: schema/plan/relations)
#   2. dag-ml-cli      validate-data-binding (the lossy ExternalDataPlanEnvelope
#                       wrapped by a hand-authored DataBinding in a CampaignSpec)
#
# Fingerprints are content-derived, so no brittle byte-golden is pinned — the
# "golden" is the round trip: Rust loader -> DatasetPackage -> PackageProvider
# -> both CLIs accept its envelope. Needs the sibling
# `dag-ml-data` and `dag-ml` repos (the ecosystem tree); if either is absent the
# script SKIPS (exit 0) with a message rather than failing unless
# NIRS4ALL_REQUIRE_DAGML_SIBLINGS=1 is set. When siblings are present, Cargo is
# patched to use the local dag-ml-data checkout instead of the crates.io release.
set -euo pipefail

io_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sib="$(cd "${io_root}/.." && pwd)"
dmd="${NIRS4ALL_DAG_ML_DATA:-${sib}/dag-ml-data}"
dml="${NIRS4ALL_DAG_ML:-${sib}/dag-ml}"
# The release default must carry explicit, stable identity. Legacy convention
# corpora without sample_index remain useful loader goldens, but the dag-ml-data
# bridge correctly refuses them because their samples cannot be tracked safely.
if [[ "$#" -eq 0 ]]; then
  inputs=("${io_root}/tests/cross_binding/corpus/identity.spec.json")
else
  inputs=("$@")
fi
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

if [[ ! -d "${dmd}" || ! -d "${dml}" ]]; then
  msg="sibling dag-ml-data (${dmd}) or dag-ml (${dml}) not found; cross-CLI conformance not run."
  if [[ "${NIRS4ALL_REQUIRE_DAGML_SIBLINGS:-0}" == "1" ]]; then
    echo "FAIL: ${msg}" >&2
    exit 1
  fi
  echo "SKIP: ${msg}"
  exit 0
fi

for repository in "${io_root}" "${dmd}" "${dml}"; do
  if [[ -n "$(git -C "${repository}" status --porcelain=v1 --untracked-files=all)" ]]; then
    echo "FAIL: cross-CLI conformance requires a clean source checkout: ${repository}" >&2
    exit 1
  fi
done
io_commit=$(git -C "${io_root}" rev-parse HEAD)
io_tree=$(git -C "${io_root}" rev-parse HEAD^{tree})
dmd_commit=$(git -C "${dmd}" rev-parse HEAD)
dml_commit=$(git -C "${dml}" rev-parse HEAD)

echo ">> building CLIs"
# Build an exact HEAD archive in the private work directory. Selecting a newer
# local dag-ml-data candidate may require a lock update; doing that in the source
# checkout would mix release evidence and can silently leave an unused patch.
io_source="${work}/io-source"
mkdir -p "${io_source}"
git -C "${io_root}" archive --format=tar HEAD | tar -x -C "${io_source}"
emit_manifest="${io_source}/crates/nirs4all-io-dagml/Cargo.toml"
dmd_version=$(sed -nE '/^\[workspace\.package\]/,/^\[/{s/^version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p}' \
  "${dmd}/Cargo.toml" | head -n1)
if [[ -z "${dmd_version}" ]]; then
  echo "FAIL: could not resolve dag-ml-data workspace version" >&2
  exit 1
fi
dagml_data_patch=(
  --config "patch.crates-io.dag-ml-data.path='${dmd}/crates/dag-ml-data'"
  --config "patch.crates-io.dag-ml-data-core.path='${dmd}/crates/dag-ml-data-core'"
  --config "patch.crates-io.dag-ml-data-provider.path='${dmd}/crates/dag-ml-data-provider'"
)
cargo update -q --manifest-path "${emit_manifest}" -p dag-ml-data \
  --precise "${dmd_version}" --offline "${dagml_data_patch[@]}"
metadata_json="${work}/emit-metadata.json"
cargo metadata --format-version 1 --manifest-path "${emit_manifest}" \
  "${dagml_data_patch[@]}" > "${metadata_json}"
python3 - "${metadata_json}" "${dmd}/crates/dag-ml-data/Cargo.toml" "${dmd_version}" <<'PY'
import json, pathlib, sys
metadata = json.load(open(sys.argv[1], encoding="utf-8"))
expected_manifest = pathlib.Path(sys.argv[2]).resolve()
expected_version = sys.argv[3]
matches = [package for package in metadata["packages"] if package["name"] == "dag-ml-data"]
if len(matches) != 1:
    raise SystemExit(f"expected one dag-ml-data package, found {len(matches)}")
package = matches[0]
if pathlib.Path(package["manifest_path"]).resolve() != expected_manifest:
    raise SystemExit(f"dag-ml-data patch was not selected: {package['manifest_path']}")
if package["version"] != expected_version or package.get("source") is not None:
    raise SystemExit(f"unexpected dag-ml-data identity: {package}")
PY
cargo build -q --locked --manifest-path "${emit_manifest}" --bin emit-dagml \
  "${dagml_data_patch[@]}"
( cd "${dmd}" && cargo build -q --locked -p dag-ml-data-cli --release )
( cd "${dml}" && cargo build -q --locked -p dag-ml-cli --release )

emit_target="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["target_directory"])' "${metadata_json}")"
emit_cli="$(find "${emit_target}" -maxdepth 2 -name emit-dagml -type f | head -1)"
dmd_cli="${dmd}/target/release/dag-ml-data-cli"
dml_cli="${dml}/target/release/dag-ml-cli"

for requested_input in "${inputs[@]}"; do
  if [[ -e "${requested_input}" ]]; then
    input="${requested_input}"
  elif [[ -e "${io_root}/tests/goldens/contract/corpus/${requested_input}" ]]; then
    input="${io_root}/tests/goldens/contract/corpus/${requested_input}"
  else
    echo "FAIL: conformance input not found: ${requested_input}" >&2
    exit 1
  fi
  case=$(basename "${requested_input}")
  case=${case%.spec.json}
  echo ">> case: ${case}"
  env_json="${work}/${case}.envelope.json"
  ext_json="${work}/${case}.external.json"
  camp_json="${work}/${case}.campaign.json"

  "${emit_cli}" "${input}" > "${env_json}"

  echo "   - dag-ml-data-cli validate-envelope"
  "${dmd_cli}" validate-envelope "${env_json}"

  # Derive the lossy ExternalDataPlanEnvelope + a minimal CampaignSpec whose one
  # DataBinding mirrors the envelope's fingerprints (no folds => fold-safety is a
  # no-op; require_relations=true exercises the relation contract).
  python3 - "${env_json}" "${ext_json}" "${camp_json}" <<'PY'
import json, sys
env = json.load(open(sys.argv[1]))
json.dump({
    "schema_version": env["schema_version"],
    "schema_fingerprint": env["schema_fingerprint"],
    "plan_fingerprint": env["plan_fingerprint"],
    "relation_fingerprint": env.get("relation_fingerprint"),
    "coordinator_relations": env.get("coordinator_relations"),
}, open(sys.argv[2], "w"), indent=2)
json.dump({
    "id": "n4io-emit-conformance",
    "root_seed": None,
    "data_bindings": {"model": [{
        "node_id": "model",
        "input_name": "X",
        "request_id": "req-1",
        "schema_fingerprint": env["schema_fingerprint"],
        "plan_fingerprint": env["plan_fingerprint"],
        "relation_fingerprint": env.get("relation_fingerprint"),
        "output_representation": env["plan"]["output_representation"],
        "require_relations": True,
    }]},
}, open(sys.argv[3], "w"), indent=2)
PY

  echo "   - dag-ml-cli validate-data-binding"
  "${dml_cli}" validate-data-binding \
    --campaign "${camp_json}" --envelope "${ext_json}" --node model --input X
done

if [[ "$(git -C "${io_root}" rev-parse HEAD)" != "${io_commit}" ]] || \
   [[ "$(git -C "${io_root}" rev-parse HEAD^{tree})" != "${io_tree}" ]] || \
   [[ "$(git -C "${dmd}" rev-parse HEAD)" != "${dmd_commit}" ]] || \
   [[ "$(git -C "${dml}" rev-parse HEAD)" != "${dml_commit}" ]]; then
  echo "FAIL: source identity changed during cross-CLI conformance" >&2
  exit 1
fi
for repository in "${io_root}" "${dmd}" "${dml}"; do
  if [[ -n "$(git -C "${repository}" status --porcelain=v1 --untracked-files=all)" ]]; then
    echo "FAIL: source checkout changed during cross-CLI conformance: ${repository}" >&2
    exit 1
  fi
done

echo "ALL CASES PASSED both CLIs."
