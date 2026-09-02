export interface Upstream {
  key: 'dag_ml' | 'dag_ml_data' | 'formats' | 'io' | 'datasets' | 'methods';
  candidates: readonly string[];
  role: string;
}

export interface UpstreamProxy {
  key: Upstream['key'];
  import(): Promise<unknown>;
}

export interface LocalImplementationRegistry {
  register_loss(lossReference: unknown, implementation: unknown): unknown;
  register_metric(metricReference: unknown, implementation: unknown): unknown;
  bind_training_loss(nodeTask: unknown, roleIndex?: number): unknown;
}

export interface LocalImplementationRegistryModule<T extends LocalImplementationRegistry = LocalImplementationRegistry> {
  LocalImplementationRegistry: new () => T;
}

export interface PipelineDefinition {
  name: string;
  description: string;
  random_state?: number;
  pipeline: unknown[];
}

export type RuntimeSurface = 'python' | 'r' | 'javascript_wasm' | 'rust' | 'matlab_octave';
export type CapabilityLevel = 'metadata' | 'plan' | 'execute-local' | 'execute-remote' | 'parity-validated';

export interface RuntimeContract {
  surface: RuntimeSurface;
  pipelineExecution: CapabilityLevel;
  pipelineEntrypoint: string;
  serializedModelPredict: boolean;
  predictEntrypoint: string | null;
}

export interface ArtifactContract {
  id: 'conformal.calibrated_result' | 'robustness.summary' | 'tuning.summary' | 'tuning.ordered_search_space' | 'keyword.registry';
  schema: string;
  producer: 'full-python-nirs4all';
  consumerLevel: Readonly<Record<RuntimeSurface, 'metadata'>>;
  pythonSurface: string;
  portableClaim: 'not-exposed-in-nirs4all-core' | 'summary-json-contract-only' | 'search-space-json-contract-only' | 'registry-json-contract-only';
  optionalPayloadFields: readonly string[];
  publishedConstants?: Readonly<Record<string, readonly string[]>>;
  requiredRegistryEntries: readonly string[];
}

export interface ControllerCapability {
  id: string;
  kind: 'splitter' | 'transform' | 'model' | 'pipeline';
  domain: Upstream['key'];
  label: string;
  operatorClasses: readonly string[];
  ports: {
    inputs: readonly string[];
    outputs: readonly string[];
  };
  parameters: readonly string[];
  runtime: Readonly<Record<RuntimeSurface, CapabilityLevel>>;
  executionPath: 'portable_pipeline' | 'run_portable_pipeline';
  composes?: readonly string[];
}

export interface CapabilityManifest {
  schema: 'nirs4all-core.capabilities.v1';
  aggregate: 'nirs4all-core';
  runtimeSurfaces: readonly RuntimeSurface[];
  runtimeContracts: readonly RuntimeContract[];
  artifactContracts: readonly ArtifactContract[];
  portableOperatorClasses: readonly string[];
  controllers: readonly ControllerCapability[];
}

export interface PortableMatrixDataset {
  X: Float64Array | number[] | readonly number[] | readonly (readonly number[])[];
  y: Float64Array | number[] | readonly number[] | readonly (readonly number[])[];
  rows?: number;
  cols?: number;
  n_samples?: number;
  n_features?: number;
}

export interface PortableSplitResult {
  kind: 'all' | 'KennardStone';
  trainIndices: number[];
  testIndices: number[];
}

export interface PortableVariantResult {
  n_components: number;
  rmse: number;
  predictions: number[];
}

export interface PortablePlsModel {
  type: 'PLSRegression';
  n_components: number;
  coefficients: number[];
  xMean: number[];
  yMean: number[];
  intercept: number[] | null;
  n_features: number;
  n_targets: number;
}

export interface PortableExecutionResult {
  name: string;
  rows: number;
  cols: number;
  split: PortableSplitResult;
  preprocessing: { type: string; params: number[] }[];
  variants: PortableVariantResult[];
  selected: PortableVariantResult;
  model: PortablePlsModel;
  targets: number[];
}

export interface PortablePredictionResult {
  data: number[];
  rows: number;
  cols: number;
}

export interface ArchiveV2ReplayDataset {
  X: Float64Array | readonly number[] | readonly (readonly number[])[];
  rows?: number;
  cols?: number;
  n_samples?: number;
  n_features?: number;
  sampleIds?: readonly string[];
  sample_ids?: readonly string[];
}

export interface ArchiveV2ReplayResult {
  schema: 'nirs4all.core.archive-v2-replay.v1';
  engine: 'nirs4all-methods-wasm';
  fallback: false;
  archiveId: string;
  archiveSha256: string;
  artifactId: string;
  bindingId: string;
  nodeId: string;
  portName: string;
  sampleIds: readonly string[];
  targetNames: readonly string[];
  data: readonly number[];
  rows: number;
  cols: number;
}

export const upstreams: readonly Upstream[];
export const portableOperatorClasses: readonly string[];
export const runtimeSurfaces: readonly RuntimeSurface[];
export const runtimeContracts: readonly RuntimeContract[];
export const requiredKeywordRegistryEntries: readonly string[];
export const artifactContracts: readonly ArtifactContract[];
export const controllerCapabilities: readonly ControllerCapability[];
export function capabilityManifest(): CapabilityManifest;

export function upstream(name: string): Upstream | null;
export function importUpstream(name: string): Promise<unknown>;
export function loadFormats(): Promise<unknown>;
export function loadIo(): Promise<unknown>;
export function loadDatasets(): Promise<unknown>;
export function loadMethods(): Promise<unknown>;
export function loadDagMl(): Promise<unknown>;
export function loadDagMlData(): Promise<unknown>;
export function localImplementationRegistry<T extends LocalImplementationRegistry = LocalImplementationRegistry>(
  dagMlModule?: LocalImplementationRegistryModule<T> | null,
): Promise<T>;
export function loadPortableStack(keys?: readonly string[]): Promise<Record<string, unknown>>;
export function loadMethodsWasm(): Promise<unknown>;
export function methodsWasm(): unknown;
export function loadDagMlWasm(): Promise<unknown>;
export function loadDagMlDataWasm(): Promise<unknown>;
export function loadDatasetsWasm(): Promise<unknown>;
export function loadDataIoWasm(): Promise<{ formats: unknown; io: unknown }>;

export const formats: UpstreamProxy;
export const io: UpstreamProxy;
export const datasets: UpstreamProxy;
export const methods: UpstreamProxy;
export const dagMl: UpstreamProxy;
export const dagMlData: UpstreamProxy;

export function loadPipelineDefinition(source: string | unknown[] | Record<string, unknown>): PipelineDefinition;
export function portableClassNames(definition: PipelineDefinition | unknown[] | Record<string, unknown>): string[];
export function parseExecutionPlan(source: string | PipelineDefinition | unknown[] | Record<string, unknown>): {
  splitter: { type: 'KennardStone'; params: Record<string, unknown> } | null;
  preprocessing: { type: 'StandardNormalVariate' | 'SavitzkyGolay'; params: number[] }[];
  nComponents: number[];
};
export function runPortablePipeline(
  source: string | PipelineDefinition | unknown[] | Record<string, unknown>,
  dataset: PortableMatrixDataset,
  options?: { methods?: unknown },
): Promise<PortableExecutionResult>;
export function predictPortablePipeline(
  fitted: PortableExecutionResult | { preprocessing?: { type: string; params: number[] }[]; model?: PortablePlsModel },
  dataset: Omit<PortableMatrixDataset, 'y'>,
  options?: { methods?: unknown },
): Promise<PortablePredictionResult>;
export function loadArchiveV2Native(): Promise<unknown>;
export function replayMethodsArchiveV2(
  archiveBytes: ArrayBuffer | ArrayBufferView,
  dataset: ArchiveV2ReplayDataset,
): Promise<ArchiveV2ReplayResult>;
