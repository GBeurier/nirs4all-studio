import { parse as parseYaml } from 'yaml';

export const upstreams = Object.freeze([
  {
    key: 'dag_ml',
    candidates: ['dag-ml-wasm'],
    role: 'Leakage-safe DAG/ML execution coordinator',
  },
  {
    key: 'dag_ml_data',
    candidates: ['dag-ml-data-wasm'],
    role: 'Sample-aligned data contracts for DAG/ML runtimes',
  },
  {
    key: 'formats',
    candidates: ['@nirs4all/formats-wasm'],
    role: 'Spectroscopy/NIRS vendor file readers',
  },
  {
    key: 'io',
    candidates: ['@nirs4all/io-wasm'],
    role: 'Dataset assembly bridge',
  },
  {
    key: 'datasets',
    candidates: ['@nirs4all/datasets-wasm'],
    role: 'DOI-pinned NIRS dataset catalog',
  },
  {
    key: 'methods',
    candidates: ['@nirs4all/methods'],
    role: 'Portable C ABI PLS/NIRS numerical engine',
  },
]);

export const portableOperatorClasses = Object.freeze([
  'nirs4all.operators.splitters.KennardStoneSplitter',
  'nirs4all.operators.splitters.splitters.KennardStoneSplitter',
  'nirs4all.operators.transforms.SNV',
  'nirs4all.operators.transforms.StandardNormalVariate',
  'nirs4all.operators.transforms.scalers.StandardNormalVariate',
  'nirs4all.operators.transforms.SavitzkyGolay',
  'nirs4all.operators.transforms.nirs.SavitzkyGolay',
  'sklearn.cross_decomposition.PLSRegression',
  'sklearn.cross_decomposition._pls.PLSRegression',
]);

export const runtimeSurfaces = Object.freeze([
  'python',
  'r',
  'javascript_wasm',
  'rust',
  'matlab_octave',
]);

export const runtimeContracts = Object.freeze([
  Object.freeze({
    surface: 'python',
    pipelineExecution: 'parity-validated',
    pipelineEntrypoint: 'run_portable_pipeline',
    serializedModelPredict: false,
    predictEntrypoint: null,
  }),
  Object.freeze({
    surface: 'r',
    pipelineExecution: 'parity-validated',
    pipelineEntrypoint: 'nirs4all_run_portable_pipeline',
    serializedModelPredict: false,
    predictEntrypoint: null,
  }),
  Object.freeze({
    surface: 'javascript_wasm',
    pipelineExecution: 'parity-validated',
    pipelineEntrypoint: 'runPortablePipeline',
    serializedModelPredict: true,
    predictEntrypoint: 'predictPortablePipeline',
  }),
  Object.freeze({
    surface: 'rust',
    pipelineExecution: 'parity-validated',
    pipelineEntrypoint: 'run_portable_pipeline_with_library',
    serializedModelPredict: true,
    predictEntrypoint: 'predict_exported_portable_model_with_library',
  }),
  Object.freeze({
    surface: 'matlab_octave',
    pipelineExecution: 'parity-validated',
    pipelineEntrypoint: 'runPortablePipeline',
    serializedModelPredict: false,
    predictEntrypoint: null,
  }),
]);

export const requiredKeywordRegistryEntries = Object.freeze([
  'run.tuning',
  'run.tuning.engine',
  'run.tuning.space',
  'run.tuning.force_params',
  'run.tuning.score_data',
  'run.tuning.score_data.conformal_calibration',
  'predict.coverage',
  'predict.all_predictions',
  'robustness.scenarios.kind',
  'robustness.scenarios.severity',
  'robustness.scenarios.distribution',
  'robustness.X',
  'robustness.predictor',
  'robustness.predictor_bundle',
]);

export const artifactContracts = Object.freeze([
  Object.freeze({
    id: 'conformal.calibrated_result',
    schema: 'nirs4all.dagml.conformal_store.v1',
    producer: 'full-python-nirs4all',
    consumerLevel: Object.freeze(Object.fromEntries(runtimeSurfaces.map((surface) => [surface, 'metadata']))),
    pythonSurface: 'nirs4all.calibrate / nirs4all.predict_calibrated / nirs4all.load_calibrated_result',
    portableClaim: 'not-exposed-in-nirs4all-core',
    optionalPayloadFields: Object.freeze([
      'conformal_guarantee_status',
      'calibration_replay_source',
      'tuning_calibration_source',
    ]),
    requiredRegistryEntries: Object.freeze([]),
  }),
  Object.freeze({
    id: 'robustness.summary',
    schema: 'https://nirs4all.org/schemas/robustness-summary/v1',
    producer: 'full-python-nirs4all',
    consumerLevel: Object.freeze(Object.fromEntries(runtimeSurfaces.map((surface) => [surface, 'metadata']))),
    pythonSurface: 'nirs4all.RobustnessReport.summary_artifact / nirs4all.robustness_summary_schema_json',
    portableClaim: 'summary-json-contract-only',
    optionalPayloadFields: Object.freeze(['conformal_guarantee_status', 'spectral_replay']),
    requiredRegistryEntries: Object.freeze([]),
  }),
  Object.freeze({
    id: 'tuning.summary',
    schema: 'https://nirs4all.org/schemas/tuning-summary/v1',
    producer: 'full-python-nirs4all',
    consumerLevel: Object.freeze(Object.fromEntries(runtimeSurfaces.map((surface) => [surface, 'metadata']))),
    pythonSurface: 'nirs4all.TuningResult.summary_artifact / nirs4all.tuning_summary_schema_json',
    portableClaim: 'summary-json-contract-only',
    optionalPayloadFields: Object.freeze(['sampler', 'pruner', 'seed', 'persistence', 'trials[*].diagnostics']),
    requiredRegistryEntries: Object.freeze([]),
  }),
  Object.freeze({
    id: 'tuning.ordered_search_space',
    schema: 'https://nirs4all.org/schemas/tuning-ordered-search-space/v1',
    producer: 'full-python-nirs4all',
    consumerLevel: Object.freeze(Object.fromEntries(runtimeSurfaces.map((surface) => [surface, 'metadata']))),
    pythonSurface: 'nirs4all.inspect_tuning_space / nirs4all.NativeTuning.inspect_space / nirs4all.tuning_space_schema_json / nirs4all CLI tuning-space',
    portableClaim: 'search-space-json-contract-only',
    optionalPayloadFields: Object.freeze([]),
    requiredRegistryEntries: Object.freeze(['run.tuning.space', 'run.tuning.force_params']),
  }),
  Object.freeze({
    id: 'keyword.registry',
    schema: 'nirs4all.keyword_registry.v1',
    producer: 'full-python-nirs4all',
    consumerLevel: Object.freeze(Object.fromEntries(runtimeSurfaces.map((surface) => [surface, 'metadata']))),
    pythonSurface: 'nirs4all.get_keyword_registry / nirs4all.keyword_registry_json / nirs4all.keyword_registry_schema_json / nirs4all.TUNING_OPTIMIZER_PERSISTENCE_KEYS / nirs4all.ROBUSTNESS_SCENARIO_KINDS / nirs4all.ROBUSTNESS_STOCHASTIC_SCENARIO_KINDS / nirs4all.ROBUSTNESS_SCENARIO_DISTRIBUTIONS / nirs4all.ROBUSTNESS_MODES / nirs4all.ROBUSTNESS_EXECUTABLE_MODES',
    portableClaim: 'registry-json-contract-only',
    optionalPayloadFields: Object.freeze([]),
    publishedConstants: Object.freeze({
      ROBUSTNESS_SCENARIO_DISTRIBUTIONS: Object.freeze(['normal', 'uniform']),
    }),
    requiredRegistryEntries: requiredKeywordRegistryEntries,
  }),
]);

const parityRuntime = Object.freeze(Object.fromEntries(
  runtimeSurfaces.map((surface) => [surface, 'parity-validated']),
));

export const controllerCapabilities = Object.freeze([
  Object.freeze({
    id: 'split.kennard_stone',
    kind: 'splitter',
    domain: 'methods',
    label: 'Kennard-Stone split',
    operatorClasses: Object.freeze([
      'nirs4all.operators.splitters.KennardStoneSplitter',
      'nirs4all.operators.splitters.splitters.KennardStoneSplitter',
    ]),
    ports: Object.freeze({
      inputs: Object.freeze(['X']),
      outputs: Object.freeze(['train_indices', 'test_indices']),
    }),
    parameters: Object.freeze(['test_size']),
    runtime: parityRuntime,
    executionPath: 'portable_pipeline',
  }),
  Object.freeze({
    id: 'preprocess.snv',
    kind: 'transform',
    domain: 'methods',
    label: 'Standard normal variate',
    operatorClasses: Object.freeze([
      'nirs4all.operators.transforms.SNV',
      'nirs4all.operators.transforms.StandardNormalVariate',
      'nirs4all.operators.transforms.scalers.StandardNormalVariate',
    ]),
    ports: Object.freeze({
      inputs: Object.freeze(['X']),
      outputs: Object.freeze(['X_transformed']),
    }),
    parameters: Object.freeze([]),
    runtime: parityRuntime,
    executionPath: 'portable_pipeline',
  }),
  Object.freeze({
    id: 'preprocess.savgol',
    kind: 'transform',
    domain: 'methods',
    label: 'Savitzky-Golay',
    operatorClasses: Object.freeze([
      'nirs4all.operators.transforms.SavitzkyGolay',
      'nirs4all.operators.transforms.nirs.SavitzkyGolay',
    ]),
    ports: Object.freeze({
      inputs: Object.freeze(['X']),
      outputs: Object.freeze(['X_transformed']),
    }),
    parameters: Object.freeze(['window_length', 'polyorder', 'deriv', 'mode', 'cval']),
    runtime: parityRuntime,
    executionPath: 'portable_pipeline',
  }),
  Object.freeze({
    id: 'model.pls_regression',
    kind: 'model',
    domain: 'methods',
    label: 'PLS regression',
    operatorClasses: Object.freeze([
      'sklearn.cross_decomposition.PLSRegression',
      'sklearn.cross_decomposition._pls.PLSRegression',
    ]),
    ports: Object.freeze({
      inputs: Object.freeze(['X', 'y']),
      outputs: Object.freeze(['predictions', 'model']),
    }),
    parameters: Object.freeze(['n_components', '_range_']),
    runtime: parityRuntime,
    executionPath: 'portable_pipeline',
  }),
  Object.freeze({
    id: 'pipeline.portable_methods',
    kind: 'pipeline',
    domain: 'methods',
    label: 'Portable methods pipeline',
    operatorClasses: Object.freeze([]),
    ports: Object.freeze({
      inputs: Object.freeze(['pipeline', 'dataset']),
      outputs: Object.freeze(['execution_result', 'predictions', 'model']),
    }),
    parameters: Object.freeze([]),
    runtime: parityRuntime,
    executionPath: 'run_portable_pipeline',
    composes: Object.freeze([
      'split.kennard_stone',
      'preprocess.snv',
      'preprocess.savgol',
      'model.pls_regression',
    ]),
  }),
]);

export function capabilityManifest() {
  return clone({
    schema: 'nirs4all-core.capabilities.v1',
    aggregate: 'nirs4all-core',
    runtimeSurfaces,
    runtimeContracts,
    artifactContracts,
    portableOperatorClasses,
    controllers: controllerCapabilities,
  });
}

const portableOperatorSet = new Set(portableOperatorClasses);

const upstreamByKey = new Map(upstreams.map((item) => [item.key, item]));

export function upstream(name) {
  return upstreamByKey.get(name) ?? null;
}

export async function importUpstream(name) {
  const item = upstream(name);
  if (!item) {
    throw new Error(`Unknown nirs4all upstream: ${name}`);
  }

  for (const candidate of item.candidates) {
    try {
      return await importUpstreamCandidate(candidate);
    } catch (error) {
      if (isMissingModuleError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `nirs4all upstream '${name}' is not installed. Tried ${item.candidates.join(', ')}.`,
  );
}

export const formats = Object.freeze({ key: 'formats', import: () => importUpstream('formats') });
export const io = Object.freeze({ key: 'io', import: () => importUpstream('io') });
export const datasets = Object.freeze({ key: 'datasets', import: () => importUpstream('datasets') });
export const methods = Object.freeze({ key: 'methods', import: () => importUpstream('methods') });
export const dagMl = Object.freeze({ key: 'dag_ml', import: () => importUpstream('dag_ml') });
export const dagMlData = Object.freeze({
  key: 'dag_ml_data',
  import: () => importUpstream('dag_ml_data'),
});

export const loadFormats = () => importUpstream('formats');
export const loadIo = () => importUpstream('io');
export const loadDatasets = () => importUpstream('datasets');
export const loadMethods = () => importUpstream('methods');
export const loadDagMl = () => importUpstream('dag_ml');
export const loadDagMlData = () => importUpstream('dag_ml_data');

export async function localImplementationRegistry(dagMlModule = null) {
  const module = dagMlModule ?? await loadDagMl();
  const Registry = module?.LocalImplementationRegistry;
  if (typeof Registry !== 'function') {
    throw new TypeError(
      'The loaded dag-ml-wasm binding does not expose LocalImplementationRegistry; upgrade dag-ml-wasm.',
    );
  }
  const registry = new Registry();
  const missing = ['register_loss', 'register_metric', 'bind_training_loss'].filter(
    (name) => typeof registry?.[name] !== 'function',
  );
  if (missing.length > 0) {
    throw new TypeError(
      `The loaded dag-ml-wasm LocalImplementationRegistry does not expose ${missing.join(', ')}; upgrade dag-ml-wasm.`,
    );
  }
  return registry;
}

let methodsPromise = null;
let methodsModule = null;

export async function loadMethodsWasm() {
  if (!methodsPromise) {
    methodsPromise = (async () => {
      const mod = await loadMethods();
      if (typeof mod.loadModule === 'function') {
        await mod.loadModule();
      }
      methodsModule = mod;
      return mod;
    })();
  }
  return methodsPromise;
}

export function methodsWasm() {
  if (!methodsModule) {
    throw new Error('nirs4all methods WASM is not loaded; call loadMethodsWasm() first.');
  }
  return methodsModule;
}

function initializedWasmLoader(load, init) {
  let promise = null;
  return async () => {
    if (!promise) {
      promise = (async () => {
        const mod = await load();
        if (typeof init === 'function') {
          await init(mod);
        } else if (typeof mod.default === 'function') {
          await mod.default();
        }
        return mod;
      })();
    }
    return promise;
  };
}

export const loadDagMlWasm = initializedWasmLoader(loadDagMl);
export const loadDagMlDataWasm = initializedWasmLoader(loadDagMlData);
export const loadDatasetsWasm = initializedWasmLoader(loadDatasets);

export async function loadDataIoWasm() {
  const [formatsMod, ioMod] = await Promise.all([
    initializedFormatsWasm(),
    initializedIoWasm(),
  ]);
  return { formats: formatsMod, io: ioMod };
}

const initializedFormatsWasm = initializedWasmLoader(loadFormats);
const initializedIoWasm = initializedWasmLoader(loadIo);

export async function loadPortableStack(keys = upstreams.map((item) => item.key)) {
  const loaded = {};
  for (const key of keys) {
    loaded[key] = await importUpstream(key);
  }
  return loaded;
}

export function loadPipelineDefinition(source) {
  const data = typeof source === 'string' ? parsePipelineText(source) : clone(source);
  const normalized = normalizePipelineRoot(data);
  const pipeline = normalized.pipeline;
  if (!Array.isArray(pipeline)) {
    throw new Error("Pipeline definition key 'pipeline' or 'steps' must contain an array of steps.");
  }

  const definition = {
    name: String(normalized.name || 'pipeline'),
    description: String(normalized.description || ''),
    pipeline: stripComments(pipeline),
  };
  if (Number.isInteger(normalized.random_state)) {
    definition.random_state = normalized.random_state;
  }

  const unsupported = portableClassNames(definition).filter((name) => !portableOperatorSet.has(name));
  if (unsupported.length > 0) {
    throw new Error(
      `Pipeline uses operators outside the current nirs4all-core portable subset: ${[...new Set(unsupported)].join(', ')}`,
    );
  }

  return definition;
}

export function portableClassNames(definition) {
  const root = definition && Array.isArray(definition.pipeline) ? definition.pipeline : definition;
  const classes = [];
  collectClasses(root, classes);
  return classes;
}

function isMissingModuleError(error) {
  return error && (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED');
}

function importUpstreamCandidate(candidate) {
  switch (candidate) {
    case 'dag-ml-wasm':
      return import('dag-ml-wasm');
    case 'dag-ml-data-wasm':
      return import('dag-ml-data-wasm');
    case '@nirs4all/formats-wasm':
      return import('@nirs4all/formats-wasm');
    case '@nirs4all/io-wasm':
      return import('@nirs4all/io-wasm');
    case '@nirs4all/datasets-wasm':
      return import('@nirs4all/datasets-wasm');
    case '@nirs4all/methods':
      return import('@nirs4all/methods');
    default:
      return import(candidate);
  }
}

function parsePipelineText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return parseYaml(text);
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizePipelineRoot(data) {
  if (Array.isArray(data)) {
    return { pipeline: data };
  }
  if (!data || typeof data !== 'object') {
    throw new TypeError("Pipeline definition must be an array or an object with a 'pipeline'/'steps' key.");
  }
  if (data.pipeline !== undefined) {
    return data;
  }
  if (data.steps !== undefined) {
    return { ...data, pipeline: data.steps };
  }
  throw new Error("Invalid pipeline definition format. Expected an array or an object with a 'pipeline' or 'steps' key.");
}

function stripComments(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => !isCommentStep(item)).map(stripComments);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '_comment')
        .map(([key, item]) => [key, stripComments(item)]),
    );
  }
  return value;
}

function isCommentStep(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && value._comment !== undefined;
}

function collectClasses(value, output) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectClasses(item, output);
    }
    return;
  }
  if (value && typeof value === 'object') {
    if (typeof value.class === 'string') {
      output.push(value.class);
    }
    for (const item of Object.values(value)) {
      collectClasses(item, output);
    }
  }
}

export { parseExecutionPlan, predictPortablePipeline, runPortablePipeline } from './execution.js';
export {
  inspectMethodsArchiveV2Predictors,
  loadArchiveV2Native,
  replayMethodsArchiveV2,
} from './archive-v2.js';
