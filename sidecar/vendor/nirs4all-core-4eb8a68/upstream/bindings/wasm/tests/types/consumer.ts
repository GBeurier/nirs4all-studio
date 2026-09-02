import {
  dagMl,
  dagMlData,
  datasets,
  formats,
  importUpstream,
  io,
  loadDagMlDataWasm,
  loadDagMlWasm,
  loadDataIoWasm,
  loadDatasets,
  loadDatasetsWasm,
  loadFormats,
  loadIo,
  localImplementationRegistry,
  loadMethods,
  loadMethodsWasm,
  loadPipelineDefinition,
  loadPortableStack,
  methods,
  methodsWasm,
  parseExecutionPlan,
  portableClassNames,
  portableOperatorClasses,
  predictPortablePipeline,
  runPortablePipeline,
  upstream,
  upstreams,
  type PipelineDefinition,
  type PortableExecutionResult,
  type PortableMatrixDataset,
  type PortablePredictionResult,
  type PortablePlsModel,
  type PortableSplitResult,
  type PortableVariantResult,
  type Upstream,
  type UpstreamProxy,
} from 'nirs4all';

const definition: PipelineDefinition = loadPipelineDefinition({
  name: 'typed-consumer',
  pipeline: [
    { class: 'nirs4all.operators.transforms.StandardNormalVariate' },
    {
      model: {
        class: 'sklearn.cross_decomposition.PLSRegression',
        params: { n_components: 2 },
      },
    },
  ],
});

const classes: string[] = portableClassNames(definition);
const plan = parseExecutionPlan(definition);
const upstreamList: readonly Upstream[] = upstreams;
const firstUpstream: Upstream | null = upstream('methods');
const localRegistry: Promise<unknown> = localImplementationRegistry();
const proxy: UpstreamProxy = methods;
const allProxyKeys: string[] = [formats.key, io.key, datasets.key, dagMl.key, dagMlData.key, proxy.key];
const operatorClasses: readonly string[] = portableOperatorClasses;

const split: PortableSplitResult = {
  kind: 'all',
  trainIndices: [0, 1],
  testIndices: [0, 1],
};
const variant: PortableVariantResult = {
  n_components: 2,
  rmse: 0,
  predictions: [1, 2],
};
const model: PortablePlsModel = {
  type: 'PLSRegression',
  n_components: 2,
  coefficients: [1, 0],
  xMean: [0, 0],
  yMean: [0],
  intercept: null,
  n_features: 2,
  n_targets: 1,
};
const fitted: PortableExecutionResult = {
  name: definition.name,
  rows: 2,
  cols: 2,
  split,
  preprocessing: [{ type: 'StandardNormalVariate', params: [] }],
  variants: [variant],
  selected: variant,
  model,
  targets: [1, 2],
};
const dataset: PortableMatrixDataset = {
  X: [
    [1, 2],
    [3, 4],
  ],
  y: [1, 2],
  rows: 2,
  cols: 2,
};

const fittedPromise: Promise<PortableExecutionResult> = runPortablePipeline(definition, dataset, {
  methods: {},
});
const predictionPromise: Promise<PortablePredictionResult> = predictPortablePipeline(fitted, dataset, {
  methods: {},
});
const loaders: Promise<unknown>[] = [
  importUpstream('methods'),
  loadFormats(),
  loadIo(),
  loadDatasets(),
  loadMethods(),
  loadDagMlWasm(),
  loadDagMlDataWasm(),
  loadDatasetsWasm(),
  loadMethodsWasm(),
];
const stackPromise: Promise<Record<string, unknown>> = loadPortableStack(['methods', 'formats']);
const dataIoPromise: Promise<{ formats: unknown; io: unknown }> = loadDataIoWasm();
const maybeLoadedMethods: unknown = methodsWasm();

void classes;
void plan;
void upstreamList;
void firstUpstream;
void localRegistry;
void allProxyKeys;
void operatorClasses;
void fittedPromise;
void predictionPromise;
void loaders;
void stackPromise;
void dataIoPromise;
void maybeLoadedMethods;
