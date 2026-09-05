#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "..");
const fixture = path.join(repo, "examples", "fixtures", "oof_campaign");
const pkgDir = path.resolve(
  process.argv[2] || path.join(repo, "target", "wasm-web", "dag-ml-data-wasm"),
);
const dagMlData = await import(pathToFileURL(path.join(pkgDir, "dag_ml_data_wasm.js")).href);
const SHARED_FOLD_SET_FINGERPRINT =
  "54d3185d6c628ef0df848828a8d8ae650222a283a78bbd3ab3bc2256f222c05c";
const REQUIRED_DTS_EXPORTS = [
  "build_coordinator_data_plan_envelope_json",
  "contract_manifest_json",
  "dag_ml_data_version",
  "dataset_schema_fingerprint_json",
  "fold_set_fingerprint_json",
  "plan_model_input_json",
  "validate_fold_set_against_sample_relations_json",
];

const wasmBytes = fs.readFileSync(path.join(pkgDir, "dag_ml_data_wasm_bg.wasm"));
dagMlData.initSync({ module: wasmBytes });

function readFixture(name) {
  return fs.readFileSync(path.join(fixture, name), "utf8");
}

function assertPackageMetadata(expectedVersion) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  if (packageJson.name !== "dag-ml-data-wasm") {
    throw new Error("WASM package.json has wrong package name");
  }
  if (packageJson.version !== expectedVersion) {
    throw new Error("WASM package.json version does not match contract manifest");
  }
  if (
    packageJson.main !== "dag_ml_data_wasm.js" &&
    packageJson.module !== "dag_ml_data_wasm.js"
  ) {
    throw new Error("WASM package.json does not point to dag_ml_data_wasm.js");
  }
  if (packageJson.types !== "dag_ml_data_wasm.d.ts") {
    throw new Error("WASM package.json does not point to dag_ml_data_wasm.d.ts");
  }
  for (const filename of [
    "dag_ml_data_wasm.js",
    "dag_ml_data_wasm_bg.wasm",
    "dag_ml_data_wasm.d.ts",
  ]) {
    if (!fs.existsSync(path.join(pkgDir, filename))) {
      throw new Error(`WASM package is missing ${filename}`);
    }
  }
  const dts = fs.readFileSync(path.join(pkgDir, "dag_ml_data_wasm.d.ts"), "utf8");
  for (const exportName of REQUIRED_DTS_EXPORTS) {
    if (!dts.includes(`export function ${exportName}(`)) {
      throw new Error(`WASM TypeScript declarations are missing ${exportName}()`);
    }
  }
}

const schemaJson = readFixture("schema_nir_6_samples.json");
const nirs4allCoreSchemaJson = readFixture("schema_nirs4all_core_contract.json");
const relationsJson = readFixture("sample_relations_grouped_augmented.json");
const sharedFoldSetJson = fs.readFileSync(
  path.join(repo, "examples", "fixtures", "shared", "fold_set_cv_partition.json"),
  "utf8",
);
const requestJson = JSON.stringify({ id: "nir-to-tabular", source_ids: ["nir"] });
const foldSet = {
  id: "cv.repetition.safe",
  sample_ids: ["S001", "S002"],
  folds: [
    {
      fold_id: "fold:0",
      train_sample_ids: ["S002"],
      validation_sample_ids: ["S001"],
    },
    {
      fold_id: "fold:1",
      train_sample_ids: ["S001"],
      validation_sample_ids: ["S002"],
    },
  ],
};
const foldSetJson = JSON.stringify(foldSet);

dagMlData.validate_dataset_schema_json(schemaJson);
dagMlData.validate_dataset_schema_json(nirs4allCoreSchemaJson);
const manifest = JSON.parse(dagMlData.contract_manifest_json());
if (manifest.crate !== "dag-ml-data") {
  throw new Error("contract manifest has wrong crate name");
}
if (manifest.version !== dagMlData.dag_ml_data_version()) {
  throw new Error("contract manifest version does not match WASM version");
}
assertPackageMetadata(manifest.version);
if (!manifest.wasm_exports.includes("plan_model_input_json")) {
  throw new Error("contract manifest is missing WASM plan export");
}
if (!manifest.capabilities.includes("structured_error_descriptors")) {
  throw new Error("contract manifest is missing structured error capability");
}
if (!manifest.c_abi_symbols.includes("dagmldata_coordinator_multi_target_arrow_json")) {
  throw new Error("contract manifest is missing multi-target C ABI export");
}
if (manifest.shared.fold_set_fixture_fingerprint !== SHARED_FOLD_SET_FINGERPRINT) {
  throw new Error("contract manifest shared fold fingerprint drifted");
}
dagMlData.validate_fold_set_json(foldSetJson);
dagMlData.validate_fold_set_against_sample_relations_json(foldSetJson, relationsJson);
dagMlData.validate_fold_set_json(sharedFoldSetJson);
if (dagMlData.fold_set_fingerprint_json(sharedFoldSetJson) !== SHARED_FOLD_SET_FINGERPRINT) {
  throw new Error("shared fold set fingerprint drifted");
}
const foldFingerprint = dagMlData.fold_set_fingerprint_json(foldSetJson);
if (foldFingerprint.length !== 64) {
  throw new Error("fold set fingerprint is not a sha256 hex digest");
}
const reorderedFoldSet = {
  ...foldSet,
  sample_ids: [...foldSet.sample_ids].reverse(),
  folds: [...foldSet.folds].reverse(),
};
if (dagMlData.fold_set_fingerprint_json(JSON.stringify(reorderedFoldSet)) !== foldFingerprint) {
  throw new Error("fold set fingerprint changed after irrelevant reordering");
}
const invalidCoreSchema = JSON.parse(nirs4allCoreSchemaJson);
invalidCoreSchema.sources[0].shape_contract.axis_sizes.wavelength.exact = 999;
try {
  dagMlData.validate_dataset_schema_json(JSON.stringify(invalidCoreSchema));
  throw new Error("invalid nirs4all-core shape_contract was accepted");
} catch (error) {
  if (!String(error).includes("shape contract")) {
    throw error;
  }
}
const invalidFoldSchema = JSON.parse(nirs4allCoreSchemaJson);
invalidFoldSchema.groups = [];
try {
  dagMlData.validate_dataset_schema_json(JSON.stringify(invalidFoldSchema));
  throw new Error("invalid nirs4all-core fold group reference was accepted");
} catch (error) {
  if (!String(error).includes("unknown group")) {
    throw error;
  }
}
const leakingRelations = JSON.parse(relationsJson);
for (const row of leakingRelations.rows) {
  if (row.sample_id === "S002") {
    row.group_id = "plant.A";
  }
}
try {
  dagMlData.validate_fold_set_against_sample_relations_json(
    foldSetJson,
    JSON.stringify(leakingRelations),
  );
  throw new Error("fold set leaking a repetition group was accepted");
} catch (error) {
  if (!String(error).includes("leaks group")) {
    throw error;
  }
}
const fingerprint = dagMlData.dataset_schema_fingerprint_json(schemaJson);
if (fingerprint.length !== 64) {
  throw new Error("schema fingerprint is not a sha256 hex digest");
}
const coreFingerprint = dagMlData.dataset_schema_fingerprint_json(nirs4allCoreSchemaJson);
if (coreFingerprint.length !== 64) {
  throw new Error("nirs4all-core schema fingerprint is not a sha256 hex digest");
}
const planJson = dagMlData.plan_model_input_json(
  schemaJson,
  readFixture("model_input_tabular_numeric.json"),
  readFixture("adapter_registry_signal_to_tabular.json"),
  requestJson,
);
const envelope = JSON.parse(
  dagMlData.build_coordinator_data_plan_envelope_json(schemaJson, planJson),
);
if (envelope.plan.id !== "nir-to-tabular") {
  throw new Error("coordinator envelope contains the wrong plan id");
}
if (!dagMlData.dag_ml_data_version()) {
  throw new Error("dag_ml_data_version() returned an empty version");
}
