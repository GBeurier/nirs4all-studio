#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as methodsModule from '@nirs4all/methods';
import { replayMethodsArchiveV2 } from '../src/index.js';

const [archivePath, scenarioPath] = process.argv.slice(2);
if (!archivePath || !scenarioPath) {
  console.error('usage: node scripts/qualify-archive-v2.mjs ARCHIVE_V2 SCENARIO_JSON');
  process.exit(2);
}

const archive = await readFile(archivePath);
const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
const prediction = scenario?.prediction;
if (scenario?.operation !== 'archive_v2_predict' || scenario?.fallback_allowed !== false
  || !prediction || !Array.isArray(prediction.x) || !Array.isArray(prediction.sample_ids)) {
  throw new Error('qualification scenario is not the closed no-fallback Archive V2 prediction contract');
}

await methodsModule.loadModule();
const ccallCounts = new Map();
const module = methodsModule.getModule();
const originalCcall = module.ccall.bind(module);
module.ccall = (symbol, ...args) => {
  ccallCounts.set(symbol, (ccallCounts.get(symbol) ?? 0) + 1);
  return originalCcall(symbol, ...args);
};

const request = {
  X: prediction.x,
  rows: prediction.x.length,
  cols: prediction.x[0].length,
  sampleIds: prediction.sample_ids,
};
const result = await replayMethodsArchiveV2(archive, request);

assert.equal(result.schema, 'nirs4all.core.archive-v2-replay.v1');
assert.equal(result.engine, 'nirs4all-methods-wasm');
assert.equal(result.fallback, false);
assert.deepEqual(result.sampleIds, ['predict.0', 'predict.1']);
assert.deepEqual(result.targetNames, ['protein', 'moisture']);
assert.equal(result.rows, 2);
assert.equal(result.cols, 2);
assert.equal(
  result.nativePredictorDescriptor.descriptor_type,
  'dagml.native_predictor_descriptor.v1',
);
assert.equal(result.nativePredictorDescriptor.schema_version, 1);
assert.equal(result.nativePredictorDescriptor.owner_controller, 'controller:methods.pls');
assert.equal(result.nativePredictorDescriptor.storage_algorithm, 0);
assert.equal(result.nativePredictorDescriptor.dimensions.n_features, 2);
assert.equal(result.nativePredictorDescriptor.dimensions.n_targets, 2);
if (result.nativePredictorDescriptor.format_version === 2) {
  assert.equal(result.nativePredictorDescriptor.writer_abi.minor, 5);
  assert.equal(
    result.nativePredictorDescriptor.pipeline?.pipeline_type,
    'n4m.snv_savgol_smooth.v1',
  );
  assert.equal(result.nativePredictorDescriptor.pipeline?.fingerprint_algorithm, 'fnv1a64.v1');
  assert.match(result.nativePredictorDescriptor.pipeline?.native_fingerprint ?? '', /^[0-9a-f]{16}$/);
} else {
  assert.equal(result.nativePredictorDescriptor.format_version, 1);
  assert.equal(result.nativePredictorDescriptor.pipeline, undefined);
}
assert.deepEqual(result.data, [
  1.6363636363636365,
  13.272727272727273,
  2.4999999999999996,
  15,
]);
assert.equal(ccallCounts.get('n4m_model_import_from_buffer'), 1);
assert.equal(ccallCounts.get('n4m_serialization_inspect_model_v1'), 1);
assert.equal(ccallCounts.get('n4m_serialization_inspect_pipeline_v1'), 1);
assert.equal(ccallCounts.get('n4m_model_predict_alloc'), 1);
assert.equal(ccallCounts.get('n4m_estimators_pls_fit') ?? 0, 0);
assert.equal(ccallCounts.get('n4m_wasm_pls_fit') ?? 0, 0);

const tampered = mutateStoredMember(archive, 'methods/model_compat.0.n4mm', (payload) => {
  payload[4] ^= 0x01;
});
await assert.rejects(
  replayMethodsArchiveV2(tampered, request),
  /Core Archive V2 refusal.*inventory (?:identity|hash or size) mismatch/,
);

const badInventory = mutateStoredMember(archive, 'manifest.json', (payload) => {
  replaceAscii(payload, '"uncompressed_size_bytes":5921', '"uncompressed_size_bytes":5922');
});
await assert.rejects(
  replayMethodsArchiveV2(badInventory, request),
  /Core Archive V2 refusal.*inventory must contain each payload exactly once/,
);

console.log(JSON.stringify({
  status: 'passed',
  runtime: `node-${process.versions.node}`,
  operation: scenario.operation,
  archive_sha256: result.archiveSha256,
  target_names: result.targetNames,
  predictions: result.data,
  methods_import_calls: ccallCounts.get('n4m_model_import_from_buffer'),
  methods_inspect_calls: ccallCounts.get('n4m_serialization_inspect_model_v1'),
  methods_pipeline_inspect_calls: ccallCounts.get('n4m_serialization_inspect_pipeline_v1'),
  methods_predict_calls: ccallCounts.get('n4m_model_predict_alloc'),
  methods_fit_calls: (ccallCounts.get('n4m_estimators_pls_fit') ?? 0)
    + (ccallCounts.get('n4m_wasm_pls_fit') ?? 0),
  digest_refused: true,
  inventory_refused: true,
  methods_peer_loaded: true,
}));

function mutateStoredMember(source, memberName, mutate) {
  const bytes = new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error('qualification archive has no ZIP end record');
  const count = view.getUint16(eocd + 10, true);
  let central = view.getUint32(eocd + 16, true);
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(central, true) !== 0x02014b50) {
      throw new Error('qualification archive central directory is invalid');
    }
    const nameLength = view.getUint16(central + 28, true);
    const extraLength = view.getUint16(central + 30, true);
    const commentLength = view.getUint16(central + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(central + 46, central + 46 + nameLength));
    if (name === memberName) {
      const local = view.getUint32(central + 42, true);
      if (view.getUint32(local, true) !== 0x04034b50) {
        throw new Error(`qualification member ${memberName} has no local header`);
      }
      const size = view.getUint32(central + 24, true);
      const dataStart = local + 30 + view.getUint16(local + 26, true)
        + view.getUint16(local + 28, true);
      const payload = bytes.subarray(dataStart, dataStart + size);
      mutate(payload);
      const crc = crc32(payload);
      view.setUint32(local + 14, crc, true);
      view.setUint32(central + 16, crc, true);
      return bytes;
    }
    central += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`qualification archive has no ${memberName} member`);
}

function replaceAscii(bytes, before, after) {
  if (before.length !== after.length) throw new Error('replacement must preserve archive size');
  const source = new TextEncoder().encode(before);
  const replacement = new TextEncoder().encode(after);
  for (let at = 0; at <= bytes.length - source.length; at += 1) {
    if (source.every((value, index) => bytes[at + index] === value)) {
      bytes.set(replacement, at);
      return;
    }
  }
  throw new Error(`qualification member lacks ${before}`);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
