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
# "golden" is the round trip: emit -> both CLIs accept. Needs the sibling
# `dag-ml-data` and `dag-ml` repos (the ecosystem tree); if either is absent the
# script SKIPS (exit 0) with a message rather than failing unless
# NIRS4ALL_REQUIRE_DAGML_SIBLINGS=1 is set. When siblings are present, Cargo is
# patched to use the local dag-ml-data checkout instead of the crates.io release.
set -euo pipefail

io_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sib="$(cd "${io_root}/.." && pwd)"
dmd="${NIRS4ALL_DAG_ML_DATA:-${sib}/dag-ml-data}"
dml="${NIRS4ALL_DAG_ML:-${sib}/dag-ml}"
# Convention-loadable corpus cases (the CLI emit path goes through load/conventions);
# single_combined is inference-only and is covered by the in-process Rust test.
cases=("${@:-train_test x_y_separate}")
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

echo ">> building CLIs"
# The emit lives in the nirs4all-io-dagml bridge crate. Build it through its own
# manifest so we can patch dag-ml-data to the sibling checkout.
emit_manifest="${io_root}/crates/nirs4all-io-dagml/Cargo.toml"
dagml_data_patch=(--config "patch.crates-io.dag-ml-data.path='${dmd}/crates/dag-ml-data'")
( cargo build -q --manifest-path "${emit_manifest}" --bin emit-dagml "${dagml_data_patch[@]}" )
( cd "${dmd}" && cargo build -q -p dag-ml-data-cli --release )
( cd "${dml}" && cargo build -q -p dag-ml-cli --release )

emit_target="$(cargo metadata --format-version 1 --manifest-path "${emit_manifest}" --no-deps "${dagml_data_patch[@]}" | python3 -c 'import json, sys; print(json.load(sys.stdin)["target_directory"])')"
emit_cli="$(find "${emit_target}" -maxdepth 2 -name emit-dagml -type f | head -1)"
dmd_cli="${dmd}/target/release/dag-ml-data-cli"
dml_cli="${dml}/target/release/dag-ml-cli"

for case in ${cases[*]}; do
  echo ">> case: ${case}"
  env_json="${work}/${case}.envelope.json"
  ext_json="${work}/${case}.external.json"
  camp_json="${work}/${case}.campaign.json"

  "${emit_cli}" "${io_root}/tests/goldens/contract/corpus/${case}" > "${env_json}"

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

echo "ALL CASES PASSED both CLIs."
