import { loadMethodsWasm, loadPipelineDefinition } from './index.js';

const KENNARD_STONE = new Set([
  'nirs4all.operators.splitters.KennardStoneSplitter',
  'nirs4all.operators.splitters.splitters.KennardStoneSplitter',
]);

const SNV = new Set([
  'nirs4all.operators.transforms.SNV',
  'nirs4all.operators.transforms.StandardNormalVariate',
  'nirs4all.operators.transforms.scalers.StandardNormalVariate',
]);

const SAVGOL = new Set([
  'nirs4all.operators.transforms.SavitzkyGolay',
  'nirs4all.operators.transforms.nirs.SavitzkyGolay',
]);

const PLS = new Set([
  'sklearn.cross_decomposition.PLSRegression',
  'sklearn.cross_decomposition._pls.PLSRegression',
]);

export async function runPortablePipeline(source, dataset, options = {}) {
  const definition = loadPipelineDefinition(source);
  const methods = options.methods ?? await loadMethodsWasm();
  if (typeof methods.loadModule === 'function') {
    await methods.loadModule();
  }

  const input = coerceDataset(dataset);
  const plan = parseExecutionPlan(definition);
  const split = computeSplit(methods, plan.splitter, input);
  const train = selectRows(input.X, input.rows, input.cols, split.trainIndices);
  const test = selectRows(input.X, input.rows, input.cols, split.testIndices);
  const yTrain = selectRows(input.y, input.rows, 1, split.trainIndices);
  const yTest = selectRows(input.y, input.rows, 1, split.testIndices);

  let XTrain = train;
  let XTest = test;
  const preprocessing = [];

  for (const step of plan.preprocessing) {
    const op = methods.ppCreate(step.type, step.params);
    try {
      methods.ppFit(op, XTrain.data, XTrain.rows, XTrain.cols);
      XTrain = {
        data: methods.ppTransform(op, XTrain.data, XTrain.rows, XTrain.cols),
        rows: XTrain.rows,
        cols: XTrain.cols,
      };
      XTest = {
        data: methods.ppTransform(op, XTest.data, XTest.rows, XTest.cols),
        rows: XTest.rows,
        cols: XTest.cols,
      };
      preprocessing.push({ type: step.type, params: step.params });
    } finally {
      methods.ppDestroy(op);
    }
  }

  const candidates = plan.nComponents.map((nComponents) => {
    const model = methods.fitPls(
      { data: XTrain.data, rows: XTrain.rows, cols: XTrain.cols },
      { data: yTrain.data, rows: yTrain.rows, cols: 1 },
      nComponents,
    );
    const predicted = methods.predictPls(model, {
      data: XTest.data,
      rows: XTest.rows,
      cols: XTest.cols,
    });
    const predictions = Array.from(predicted.data);
    const targets = Array.from(yTest.data);
    return {
      n_components: nComponents,
      rmse: rmse(predictions, targets),
      predictions,
      model: serializePlsModel(model, nComponents),
    };
  });

  const selected = candidates.reduce((best, item) => (item.rmse < best.rmse ? item : best), candidates[0]);
  const variants = candidates.map(stripVariantModel);

  return {
    name: definition.name,
    rows: input.rows,
    cols: input.cols,
    split,
    preprocessing,
    variants,
    selected: stripVariantModel(selected),
    model: selected.model,
    targets: Array.from(yTest.data),
  };
}

export async function predictPortablePipeline(fitted, dataset, options = {}) {
  if (!fitted || typeof fitted !== 'object') {
    throw new TypeError('Portable prediction requires a fitted portable pipeline result.');
  }
  const methods = options.methods ?? await loadMethodsWasm();
  if (typeof methods.loadModule === 'function') {
    await methods.loadModule();
  }

  let X = coerceFeatures(dataset);
  for (const step of fitted.preprocessing ?? []) {
    const op = methods.ppCreate(step.type, step.params ?? []);
    try {
      methods.ppFit(op, X.data, X.rows, X.cols);
      X = {
        data: methods.ppTransform(op, X.data, X.rows, X.cols),
        rows: X.rows,
        cols: X.cols,
      };
    } finally {
      methods.ppDestroy(op);
    }
  }

  const model = hydratePlsModel(fitted.model ?? fitted.selected?.model);
  const predicted = methods.predictPls(model, {
    data: X.data,
    rows: X.rows,
    cols: X.cols,
  });
  return {
    data: Array.from(predicted.data),
    rows: predicted.rows,
    cols: predicted.cols,
  };
}

export function parseExecutionPlan(source) {
  const definition = source && Array.isArray(source.pipeline) ? source : loadPipelineDefinition(source);
  let splitter = null;
  const preprocessing = [];
  let modelStep = null;

  for (const step of definition.pipeline) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw new TypeError('Portable pipeline steps must be mapping objects.');
    }

    if (typeof step.class === 'string') {
      if (KENNARD_STONE.has(step.class)) {
        splitter = { type: 'KennardStone', params: step.params ?? {} };
      } else if (SNV.has(step.class)) {
        preprocessing.push({ type: 'StandardNormalVariate', params: [] });
      } else if (SAVGOL.has(step.class)) {
        preprocessing.push({ type: 'SavitzkyGolay', params: savgolParams(step.params ?? {}) });
      } else {
        throw new Error(`Portable execution does not support step class '${step.class}'.`);
      }
      continue;
    }

    if (step.model && typeof step.model === 'object') {
      if (modelStep) {
        throw new Error('Portable execution supports exactly one model step.');
      }
      modelStep = step;
      continue;
    }

    throw new Error(`Portable execution does not support pipeline step: ${JSON.stringify(step)}`);
  }

  if (!modelStep) {
    throw new Error('Portable execution requires a PLSRegression model step.');
  }
  const model = modelStep.model;
  if (!PLS.has(model.class)) {
    throw new Error(`Portable execution does not support model class '${model.class}'.`);
  }

  return {
    splitter,
    preprocessing,
    nComponents: componentValues(modelStep),
  };
}

function coerceDataset(dataset) {
  if (!dataset || typeof dataset !== 'object') {
    throw new TypeError('Portable execution requires a dataset object.');
  }
  const rows = Number(dataset.rows ?? dataset.n_samples ?? 0);
  const cols = Number(dataset.cols ?? dataset.n_features ?? 0);
  const X = flattenMatrix(dataset.X, rows, cols, 'X');
  const y = flattenMatrix(dataset.y, rows, 1, 'y');
  return { X, y, rows, cols };
}

function coerceFeatures(dataset) {
  if (!dataset || typeof dataset !== 'object') {
    throw new TypeError('Portable prediction requires a feature dataset object.');
  }
  const rows = Number(dataset.rows ?? dataset.n_samples ?? 0);
  const cols = Number(dataset.cols ?? dataset.n_features ?? 0);
  const X = flattenMatrix(dataset.X, rows, cols, 'X');
  return { data: X, rows, cols };
}

function flattenMatrix(value, rows, cols, label) {
  if (!Number.isInteger(rows) || rows <= 0 || !Number.isInteger(cols) || cols <= 0) {
    throw new TypeError(`Dataset ${label} shape must provide positive integer rows/cols.`);
  }
  if (value instanceof Float64Array) {
    if (value.length !== rows * cols) {
      throw new RangeError(`Dataset ${label} length ${value.length} does not match ${rows}x${cols}.`);
    }
    return value;
  }
  if (Array.isArray(value) && Array.isArray(value[0])) {
    const out = new Float64Array(rows * cols);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        out[r * cols + c] = Number(value[r][c]);
      }
    }
    return out;
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    if (value.length !== rows * cols) {
      throw new RangeError(`Dataset ${label} length ${value.length} does not match ${rows}x${cols}.`);
    }
    return Float64Array.from(value);
  }
  throw new TypeError(`Dataset ${label} must be a Float64Array, a flat array, or a nested row array.`);
}

function computeSplit(methods, splitter, input) {
  if (!splitter) {
    const indices = Array.from({ length: input.rows }, (_, i) => i);
    return { kind: 'all', trainIndices: indices, testIndices: indices };
  }
  const splitOptions = { testSize: numberParam(splitter.params.test_size, 0.25, 'test_size') };
  if (typeof methods.computeSplitIndices === 'function') {
    const split = methods.computeSplitIndices(
      'KennardStone',
      { data: input.X, rows: input.rows, cols: input.cols },
      null,
      splitOptions,
    );
    return {
      kind: 'KennardStone',
      trainIndices: Array.from(split.trainIndices),
      testIndices: Array.from(split.testIndices),
    };
  }
  const mask = methods.computeSplit(
    'KennardStone',
    { data: input.X, rows: input.rows, cols: input.cols },
    { data: input.y, rows: input.rows, cols: 1 },
    splitOptions,
  );
  const trainIndices = [];
  const testIndices = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) testIndices.push(i);
    else trainIndices.push(i);
  }
  return { kind: 'KennardStone', trainIndices, testIndices };
}

function selectRows(data, rows, cols, indices) {
  const out = new Float64Array(indices.length * cols);
  for (let r = 0; r < indices.length; r += 1) {
    const source = indices[r];
    if (source < 0 || source >= rows) {
      throw new RangeError(`Row index ${source} is outside 0..${rows - 1}.`);
    }
    out.set(data.subarray(source * cols, source * cols + cols), r * cols);
  }
  return { data: out, rows: indices.length, cols };
}

function savgolParams(params) {
  const delta = numberParam(params.delta, 1, 'delta');
  if (Math.abs(delta - 1) > Number.EPSILON) {
    throw new Error('Portable Savitzky-Golay execution currently supports delta=1 only.');
  }
  return [
    integerParam(params.window_length ?? params.window, 11, 'window_length', { min: 1 }),
    integerParam(params.polyorder, 3, 'polyorder', { min: 0 }),
    integerParam(params.deriv, 0, 'deriv', { min: 0 }),
    // scipy.signal.savgol_filter, and therefore nirs4all Python, default to interp.
    savgolMode(params.mode ?? 'interp'),
    numberParam(params.cval, 0, 'cval'),
  ];
}

const SAVGOL_MODES = new Map([
  ['mirror', 0],
  ['constant', 1],
  ['nearest', 2],
  ['wrap', 3],
  ['interp', 4],
]);

function savgolMode(value) {
  if (typeof value === 'string') {
    const mode = SAVGOL_MODES.get(value.toLowerCase());
    if (mode != null) {
      return mode;
    }
    throw new Error(`Unsupported Savitzky-Golay mode: ${value}`);
  }
  const mode = Number(value);
  if (Number.isInteger(mode) && mode >= 0 && mode <= 4) {
    return mode;
  }
  throw new Error(`Unsupported Savitzky-Golay mode: ${value}`);
}

function componentValues(step) {
  if (Array.isArray(step._range_)) {
    if (step.param !== 'n_components') {
      throw new Error("Portable execution only supports _range_ sweeps over 'n_components'.");
    }
    if (step._range_.length !== 3) {
      throw new Error('Invalid n_components _range_; expected [start, stop, positive_step].');
    }
    const start = integerParam(step._range_[0], undefined, 'n_components range start', { min: 1 });
    const stop = integerParam(step._range_[1], undefined, 'n_components range stop', { min: 1 });
    const stride = integerParam(step._range_[2], undefined, 'n_components range step', { min: 1 });
    if (start > stop) {
      throw new Error('Invalid n_components _range_; start must be <= stop.');
    }
    const values = [];
    for (let value = start; value <= stop; value += stride) {
      values.push(value);
    }
    return values;
  }
  const params = step.model?.params ?? {};
  return [integerParam(params.n_components, 2, 'n_components', { min: 1 })];
}

function numberParam(value, fallback, label) {
  if (value == null) {
    return fallback;
  }
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    n = Number(value);
  } else {
    throw new TypeError(`${label} must be numeric.`);
  }
  if (!Number.isFinite(n)) {
    throw new RangeError(`${label} must be finite.`);
  }
  return n;
}

function integerParam(value, fallback, label, options = {}) {
  const n = numberParam(value, fallback, label);
  if (!Number.isInteger(n)) {
    throw new RangeError(`${label} must be an integer.`);
  }
  if (options.min != null && n < options.min) {
    throw new RangeError(`${label} must be >= ${options.min}.`);
  }
  return n;
}

function rmse(predictions, targets) {
  if (predictions.length !== targets.length) {
    throw new RangeError('Prediction/target length mismatch.');
  }
  let sum = 0;
  for (let i = 0; i < predictions.length; i += 1) {
    const diff = predictions[i] - targets[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum / predictions.length);
}

function stripVariantModel(variant) {
  return {
    n_components: variant.n_components,
    rmse: variant.rmse,
    predictions: variant.predictions,
  };
}

function serializePlsModel(model, nComponents) {
  if (!model || typeof model !== 'object') {
    throw new TypeError('nirs4all-methods returned an invalid PLS model.');
  }
  return {
    type: 'PLSRegression',
    n_components: nComponents,
    coefficients: serializeVector(model.coefficients),
    xMean: serializeVector(model.xMean),
    yMean: serializeVector(model.yMean),
    intercept: model.intercept == null ? null : serializeVector(model.intercept),
    n_features: Number(model.n_features),
    n_targets: Number(model.n_targets),
  };
}

function hydratePlsModel(model) {
  if (!model || typeof model !== 'object') {
    throw new TypeError('Portable prediction requires a serialized PLS model.');
  }
  return {
    coefficients: Float64Array.from(model.coefficients ?? []),
    xMean: Float64Array.from(model.xMean ?? model.x_mean ?? []),
    yMean: Float64Array.from(model.yMean ?? model.y_mean ?? []),
    intercept: model.intercept == null ? null : Float64Array.from(model.intercept),
    n_features: Number(model.n_features),
    n_targets: Number(model.n_targets),
  };
}

function serializeVector(value) {
  if (value == null) return [];
  if (typeof value === 'number') return [value];
  return Array.from(value);
}
