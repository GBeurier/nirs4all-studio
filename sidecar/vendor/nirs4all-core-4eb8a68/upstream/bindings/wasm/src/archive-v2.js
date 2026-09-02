import { loadMethodsWasm } from './index.js';

const MAX_ROWS = 4096;
const MAX_FEATURES = 2048;
const MAX_TARGETS = 256;
const MAX_CELLS = 2_097_152;
const MAX_ARCHIVE_BYTES = 537_938_966;

let archiveNativePromise = null;

/** Load the Core-owned Archive V2 validator compiled from Rust to WASM. */
export async function loadArchiveV2Native() {
  if (!archiveNativePromise) {
    archiveNativePromise = (async () => {
      const module = await import('../native/nirs4all_core_wasm_native.js');
      if (typeof process !== 'undefined' && process?.versions?.node) {
        const { readFile } = await import('node:fs/promises');
        const bytes = await readFile(new URL(
          '../native/nirs4all_core_wasm_native_bg.wasm',
          import.meta.url,
        ));
        await module.default({ module_or_path: bytes });
      } else {
        await module.default();
      }
      return module;
    })();
  }
  return archiveNativePromise;
}

/**
 * Replay the bounded Methods-only Archive V2 contract through libn4m WASM.
 *
 * Core Rust/WASM validates the complete stored-ZIP inventory and DAG-ML package
 * before releasing opaque N4MM bytes. This JavaScript layer only validates host
 * arrays, marshals them into the public Methods C ABI and shapes the returned
 * multi-target result. It contains no estimator or prediction implementation.
 */
export async function replayMethodsArchiveV2(archiveBytes, dataset) {
  const bytes = bytesView(archiveBytes, 'Archive V2');
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new RangeError('Archive V2 exceeds the canonical Core byte budget.');
  }
  const input = features(dataset);
  const archiveNative = await loadArchiveV2Native();
  if (typeof archiveNative?.ValidatedMethodsArchiveV2 !== 'function') {
    throw new TypeError('Archive V2 native validator is unavailable or incompatible.');
  }

  // The native constructor validates before any package/model byte is exposed.
  const archive = new archiveNative.ValidatedMethodsArchiveV2(bytes);
  try {
    const targetNames = JSON.parse(archive.target_names_json());
    if (!Array.isArray(targetNames) || targetNames.length === 0
      || targetNames.length > MAX_TARGETS || new Set(targetNames).size !== targetNames.length
      || targetNames.some((name) => typeof name !== 'string' || name.length === 0
        || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name))) {
      throw new Error('Archive V2 target names exceed the bounded output contract.');
    }
    const methods = await loadMethodsWasm();
    if (typeof methods.loadModule === 'function') {
      await methods.loadModule();
    }
    const predicted = predictN4mm(
      methods,
      archive.model_bytes(),
      input,
      targetNames.length,
      archive.abi_min_minor,
    );
    return Object.freeze({
      schema: 'nirs4all.core.archive-v2-replay.v1',
      engine: 'nirs4all-methods-wasm',
      fallback: false,
      archiveId: archive.archive_id,
      archiveSha256: archive.archive_sha256,
      artifactId: archive.artifact_id,
      bindingId: archive.binding_id,
      nodeId: archive.node_id,
      portName: archive.port_name,
      sampleIds: Object.freeze([...input.sampleIds]),
      targetNames: Object.freeze([...targetNames]),
      data: Object.freeze(Array.from(predicted.data)),
      rows: predicted.rows,
      cols: predicted.cols,
    });
  } finally {
    archive.free();
  }
}

function predictN4mm(methods, modelBytes, input, expectedTargets, abiMinMinor) {
  const required = ['abiVersion', 'Context', 'getModule', 'makeMatrixView', 'readArrayView'];
  const missing = required.filter((key) => methods?.[key] == null);
  if (missing.length > 0) {
    throw new TypeError(`Methods WASM lacks Archive V2 ABI helpers: ${missing.join(', ')}.`);
  }
  const abi = methods.abiVersion();
  if (!Number.isInteger(abiMinMinor) || abiMinMinor < 0
    || !Array.isArray(abi) || abi[0] !== 2
    || !Number.isInteger(abi[1]) || abi[1] < abiMinMinor) {
    throw new Error(
      `Archive V2 requires Methods ABI 2.${String(abiMinMinor)} or newer within major 2; received ${String(abi)}.`,
    );
  }
  const module = methods.getModule();
  const context = methods.Context.create();
  const raw = bytesView(modelBytes, 'N4MM model');
  let modelBuffer = 0;
  let modelOut = 0;
  let model = 0;
  let output = 0;
  let matrix = null;
  try {
    modelBuffer = allocate(module, Math.max(1, raw.byteLength), 'N4MM input');
    modelOut = allocate(module, 4, 'N4MM model handle');
    module.HEAPU8.set(raw, modelBuffer);
    inspectN4mm(module, modelBuffer, raw.byteLength);
    module.setValue(modelOut, 0, 'i32');
    checkStatus(module, context.handle, module.ccall(
      'n4m_model_import_from_buffer',
      'number',
      ['number', 'number', 'number', 'number'],
      [context.handle, modelBuffer, raw.byteLength, modelOut],
    ), 'N4MM import');
    model = module.getValue(modelOut, 'i32');
    if (!Number.isInteger(model) || model === 0) {
      throw new Error('Methods returned a null model for validated N4MM bytes.');
    }

    const nFeatures = modelDimension(module, model, 'n4m_model_get_n_features', 'features');
    const nTargets = modelDimension(module, model, 'n4m_model_get_n_targets', 'targets');
    if (nFeatures !== input.cols) {
      throw new RangeError(`Archive model expects ${nFeatures} features; received ${input.cols}.`);
    }
    if (nTargets !== expectedTargets) {
      throw new RangeError(
        `Archive output binding declares ${expectedTargets} targets; N4MM contains ${nTargets}.`,
      );
    }
    const outputCells = input.rows * nTargets;
    if (!Number.isSafeInteger(outputCells) || nTargets > MAX_TARGETS || outputCells > MAX_CELLS) {
      throw new RangeError('Archive V2 prediction exceeds the bounded WASM output contract.');
    }

    matrix = methods.makeMatrixView(input.X, input.rows, input.cols);
    const outputOut = allocate(module, 4, 'N4MM prediction handle');
    try {
      module.setValue(outputOut, 0, 'i32');
      checkStatus(module, context.handle, module.ccall(
        'n4m_model_predict_alloc',
        'number',
        ['number', 'number', 'number', 'number'],
        [context.handle, model, matrix.viewPtr, outputOut],
      ), 'N4MM prediction');
      output = module.getValue(outputOut, 'i32');
    } finally {
      module._free(outputOut);
    }
    if (!Number.isInteger(output) || output === 0) {
      throw new Error('Methods returned a null prediction array.');
    }
    const result = methods.readArrayView(output);
    if (result.rows !== input.rows || result.cols !== expectedTargets
      || result.data.length !== input.rows * expectedTargets
      || hasNonFinite(result.data)) {
      throw new Error('Methods returned an invalid or non-finite multi-target prediction matrix.');
    }
    return result;
  } finally {
    if (output !== 0) {
      module.ccall('n4m_array_free', null, ['number'], [output]);
    }
    matrix?.free();
    if (model !== 0) {
      module.ccall('n4m_model_destroy', null, ['number'], [model]);
    }
    if (modelOut !== 0) module._free(modelOut);
    if (modelBuffer !== 0) module._free(modelBuffer);
    context.destroy();
  }
}

function inspectN4mm(module, modelBuffer, modelLength) {
  const metadata = allocate(module, 16, 'N4MM inspection metadata');
  try {
    checkStatus(module, 0, module.ccall(
      'n4m_serialization_inspect',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number'],
      [modelBuffer, modelLength, metadata, metadata + 4, metadata + 8, metadata + 12],
    ), 'N4MM header inspection');
    const formatVersion = module.getValue(metadata, 'i32') >>> 0;
    const writerAbiMajor = module.getValue(metadata + 4, 'i32') >>> 0;
    if (formatVersion !== 1 || writerAbiMajor !== 2) {
      throw new Error(
        `Archive V2 requires N4MM format 1 written by ABI major 2; received format ${formatVersion}, ABI ${writerAbiMajor}.`,
      );
    }
  } finally {
    module._free(metadata);
  }
}

function modelDimension(module, model, symbol, label) {
  const output = allocate(module, 4, `N4MM ${label}`);
  try {
    module.setValue(output, 0, 'i32');
    checkStatus(module, 0, module.ccall(
      symbol,
      'number',
      ['number', 'number'],
      [model, output],
    ), `N4MM ${label}`);
    const value = module.getValue(output, 'i32');
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Methods returned invalid N4MM ${label}: ${value}.`);
    }
    return value;
  } finally {
    module._free(output);
  }
}

function allocate(module, bytes, label) {
  const pointer = module._malloc(bytes);
  if (!Number.isInteger(pointer) || pointer === 0) {
    throw new Error(`Methods could not allocate ${label}.`);
  }
  return pointer;
}

function checkStatus(module, context, status, label) {
  if (status === 0) return;
  let detail = '';
  if (context !== 0) {
    const pointer = module.ccall(
      'n4m_context_last_error', 'number', ['number'], [context],
    );
    if (pointer !== 0) detail = module.UTF8ToString(pointer);
  }
  if (!detail) {
    const pointer = module.ccall('n4m_status_to_string', 'number', ['number'], [status]);
    if (pointer !== 0) detail = module.UTF8ToString(pointer);
  }
  throw new Error(`${label} failed with Methods status ${status}${detail ? `: ${detail}` : ''}.`);
}

function features(dataset) {
  if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) {
    throw new TypeError('Archive V2 replay requires a feature dataset object.');
  }
  const allowed = new Set(['X', 'rows', 'cols', 'n_samples', 'n_features', 'sampleIds', 'sample_ids']);
  const unknown = Object.keys(dataset).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`Archive V2 replay dataset has unknown fields: ${unknown.join(', ')}.`);
  }
  const rows = Number(dataset.rows ?? dataset.n_samples);
  const cols = Number(dataset.cols ?? dataset.n_features);
  if (!Number.isInteger(rows) || rows <= 0 || rows > MAX_ROWS
    || !Number.isInteger(cols) || cols <= 0 || cols > MAX_FEATURES
    || rows * cols > MAX_CELLS) {
    throw new RangeError('Archive V2 replay shape exceeds the bounded WASM matrix contract.');
  }
  const X = numericMatrix(dataset.X, rows, cols);
  const supplied = dataset.sampleIds ?? dataset.sample_ids;
  if (supplied != null && (!Array.isArray(supplied) || supplied.length !== rows)) {
    throw new TypeError('Archive V2 sample IDs must be an array matching the row count.');
  }
  const sampleIds = supplied == null
    ? Array.from({ length: rows }, (_, index) => `sample.${index}`)
    : supplied.slice();
  if (new Set(sampleIds).size !== rows
    || sampleIds.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 128
      || !/^[A-Za-z0-9_.:-]+$/.test(id))) {
    throw new TypeError('Archive V2 sample IDs must be distinct bounded identity strings.');
  }
  return { X, rows, cols, sampleIds };
}

function numericMatrix(value, rows, cols) {
  const expected = rows * cols;
  let result;
  if (value instanceof Float64Array) {
    if (value.length !== expected) {
      throw new RangeError('Archive V2 feature matrix shape or finite-value contract is invalid.');
    }
    result = new Float64Array(value);
  } else if (Array.isArray(value) && value.length === rows && value.every(Array.isArray)) {
    if (value.some((row) => row.length !== cols)) {
      throw new RangeError('Archive V2 feature matrix is ragged.');
    }
    result = Float64Array.from(value.flat());
  } else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    if (!Number.isInteger(value.length) || value.length !== expected) {
      throw new RangeError('Archive V2 feature matrix shape or finite-value contract is invalid.');
    }
    result = Float64Array.from(value);
  } else {
    throw new TypeError('Archive V2 feature matrix must be numeric array data.');
  }
  if (result.length !== expected || hasNonFinite(result)) {
    throw new RangeError('Archive V2 feature matrix shape or finite-value contract is invalid.');
  }
  return result;
}

function hasNonFinite(values) {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) return true;
  }
  return false;
}

function bytesView(value, label) {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`${label} must be an ArrayBuffer or byte view.`);
}
