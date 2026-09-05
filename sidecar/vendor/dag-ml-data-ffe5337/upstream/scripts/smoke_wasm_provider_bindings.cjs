#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const fixture = path.join(repo, "examples", "fixtures", "oof_campaign");
const pkgDir = path.resolve(
  process.argv[2] || path.join(repo, "target", "wasm", "dag-ml-data-wasm-provider"),
);
const dagMlData = require(path.join(pkgDir, "dag_ml_data_wasm.js"));

function readFixture(name) {
  return fs.readFileSync(path.join(fixture, name), "utf8");
}

function requireThrows(action, message) {
  try {
    action();
  } catch (_error) {
    return;
  }
  throw new Error(message);
}

if (typeof dagMlData.WasmInMemoryProvider !== "function") {
  throw new Error("provider-feature package is missing WasmInMemoryProvider");
}

const manifest = JSON.parse(dagMlData.contract_manifest_json());
if (manifest.provider_surface !== "eager-inwasm-provider") {
  throw new Error("provider-feature contract manifest is missing provider_surface");
}
if (!manifest.provider_exports.includes("WasmInMemoryProvider.release")) {
  throw new Error("provider-feature contract manifest is missing handle release");
}

const declarations = fs.readFileSync(
  path.join(pkgDir, "dag_ml_data_wasm.d.ts"),
  "utf8",
);
if (!declarations.includes("export class WasmInMemoryProvider")) {
  throw new Error("provider-feature TypeScript declarations are missing WasmInMemoryProvider");
}

const targetTables = [
  {
    target_id: "y",
    values: [
      { sample_id: "S001", value: 42.0 },
      { sample_id: "S002", value: 7.0 },
    ],
  },
];
const featureMatrices = [
  {
    feature_set_id: "x",
    representation_id: "tabular_numeric",
    feature_names: ["f0", "f1"],
    observation_ids: [
      "obs.S001.base",
      "obs.S001.rep1",
      "obs.S001.aug0",
      "obs.S002.base",
    ],
    values: [1.0, 10.0, 2.0, 20.0, 3.0, 30.0, 4.0, 40.0],
  },
];

const provider = new dagMlData.WasmInMemoryProvider(
  readFixture("coordinator_data_plan_envelope_nir.json"),
  JSON.stringify(targetTables),
  undefined,
  JSON.stringify(featureMatrices),
);
const dataHandle = provider.materialize(
  readFixture("materialization_request_model_base_x.json"),
);
const viewHandle = provider.make_view(
  dataHandle,
  JSON.stringify({
    sample_ids: ["S002", "S001"],
    columns: ["f1"],
    include_augmented: false,
    branch_view: {
      view_id: "branch_view:nir",
      branch_id: "branch:nir",
      mode: "by_source",
      selector: { source_ids: ["nir"], metadata: {}, tags: [] },
      allow_overlap: false,
      metadata: {},
    },
  }),
);

const identity = JSON.parse(provider.view_identity(viewHandle)).records;
const observations = identity.map((row) => row.observation_id);
if (observations.join(",") !== "obs.S002.base,obs.S001.base,obs.S001.rep1") {
  throw new Error("provider-feature branch view returned the wrong observation order");
}

const targets = JSON.parse(provider.target_block(viewHandle, "y"));
if (
  targets.sample_ids.join(",") !== "S002,S001" ||
  targets.values.join(",") !== "7,42"
) {
  throw new Error("provider-feature target alignment drifted");
}

const featureBlock = provider.featureBlockF64(viewHandle, "x");
const layout = JSON.parse(featureBlock.layout);
const values = Array.from(featureBlock.into_values());
if (layout.n_rows !== 3 || layout.n_cols !== 1 || values.join(",") !== "40,10,20") {
  throw new Error("provider-feature typed projection drifted");
}

const tensor = JSON.parse(
  provider.feature_collation(
    viewHandle,
    JSON.stringify({ feature_set_id: "x", policy: { emit_mask: true } }),
  ),
);
if (tensor.shape.join(",") !== "3,1" || tensor.values.join(",") !== "40,10,20") {
  throw new Error("provider-feature collation drifted");
}

if (!provider.release(viewHandle)) {
  throw new Error("provider-feature did not release the view handle");
}
requireThrows(
  () => provider.view_identity(viewHandle),
  "provider-feature accepted a released view handle",
);
if (!provider.release(dataHandle)) {
  throw new Error("provider-feature did not release the data handle");
}

console.log(
  JSON.stringify({
    observations,
    provider_surface: manifest.provider_surface,
    tensor_shape: tensor.shape,
  }),
);
