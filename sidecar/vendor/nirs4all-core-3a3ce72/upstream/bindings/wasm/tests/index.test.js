import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import * as nirs4all from '../src/index.js';
import {
  artifactContracts,
  dagMl,
  dagMlData,
  capabilityManifest,
  controllerCapabilities,
  datasets,
  formats,
  importUpstream,
  io,
  loadDagMl,
  loadDagMlData,
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
  loadArchiveV2Native,
  methods,
  methodsWasm,
  portableClassNames,
  portableOperatorClasses,
  predictPortablePipeline,
  replayMethodsArchiveV2,
  requiredKeywordRegistryEntries,
  runPortablePipeline,
  runtimeContracts,
  runtimeSurfaces,
  upstream,
  upstreams,
} from '../src/index.js';

const fixtureUrl = new URL('../../../tests/parity/fixtures/portable_methods_pipeline.json', import.meta.url);
const yamlFixtureUrl = new URL('../../../tests/parity/fixtures/portable_methods_pipeline.yaml', import.meta.url);

test('public V1 WASM surface exports expected names', () => {
  assert.deepEqual(
    Object.keys(nirs4all).sort(),
    [
      'dagMl',
      'dagMlData',
      'artifactContracts',
      'capabilityManifest',
      'controllerCapabilities',
      'datasets',
      'formats',
      'importUpstream',
      'io',
      'loadDagMl',
      'loadArchiveV2Native',
      'loadDagMlData',
      'loadDagMlDataWasm',
      'loadDagMlWasm',
      'loadDataIoWasm',
      'loadDatasets',
      'loadDatasetsWasm',
      'loadFormats',
      'loadIo',
      'localImplementationRegistry',
      'loadMethods',
      'loadMethodsWasm',
      'loadPipelineDefinition',
      'loadPortableStack',
      'methods',
      'methodsWasm',
      'parseExecutionPlan',
      'portableClassNames',
      'portableOperatorClasses',
      'predictPortablePipeline',
      'replayMethodsArchiveV2',
      'requiredKeywordRegistryEntries',
      'runPortablePipeline',
      'runtimeContracts',
      'runtimeSurfaces',
      'upstream',
      'upstreams',
    ].sort(),
  );
  assert.equal(nirs4all.loadPipelineDefinition, loadPipelineDefinition);
  assert.equal(nirs4all.runPortablePipeline, runPortablePipeline);
  assert.equal(nirs4all.predictPortablePipeline, predictPortablePipeline);
  assert.equal(nirs4all.loadArchiveV2Native, loadArchiveV2Native);
  assert.equal(nirs4all.replayMethodsArchiveV2, replayMethodsArchiveV2);
  assert.equal(nirs4all.requiredKeywordRegistryEntries, requiredKeywordRegistryEntries);
  assert.equal(nirs4all.portableOperatorClasses, portableOperatorClasses);
  assert.equal(nirs4all.runtimeSurfaces, runtimeSurfaces);
  assert.equal(nirs4all.runtimeContracts, runtimeContracts);
  assert.equal(nirs4all.artifactContracts, artifactContracts);
  assert.equal(nirs4all.controllerCapabilities, controllerCapabilities);
  assert.equal(nirs4all.capabilityManifest, capabilityManifest);
  assert.equal(nirs4all.methodsWasm, methodsWasm);
});

test('expected upstreams are registered', () => {
  assert.deepEqual(
    upstreams.map((item) => item.key),
    ['dag_ml', 'dag_ml_data', 'formats', 'io', 'datasets', 'methods'],
  );
});

test('upstream lookup returns metadata', () => {
  assert.equal(upstream('methods').role, 'Portable C ABI PLS/NIRS numerical engine');
  assert.deepEqual(upstream('methods').candidates, ['@nirs4all/methods']);
  assert.deepEqual(upstream('formats').candidates, ['@nirs4all/formats-wasm']);
  assert.deepEqual(upstream('io').candidates, ['@nirs4all/io-wasm']);
  assert.deepEqual(upstream('datasets').candidates, ['@nirs4all/datasets-wasm']);
  assert.equal(upstream('missing'), null);
});

test('domain proxies expose keys', () => {
  assert.equal(formats.key, 'formats');
  assert.equal(io.key, 'io');
  assert.equal(datasets.key, 'datasets');
  assert.equal(methods.key, 'methods');
  assert.equal(dagMl.key, 'dag_ml');
  assert.equal(dagMlData.key, 'dag_ml_data');
});

test('capability manifest describes portable custom app host controllers', () => {
  const manifest = capabilityManifest();

  assert.equal(manifest.schema, 'nirs4all-core.capabilities.v1');
  assert.deepEqual(manifest.runtimeSurfaces, [
    'python',
    'r',
    'javascript_wasm',
    'rust',
    'matlab_octave',
  ]);
  assert.deepEqual(manifest.runtimeContracts, runtimeContracts);
  assert.deepEqual(manifest.artifactContracts, artifactContracts);
  assert.deepEqual(manifest.artifactContracts.map((item) => item.id), [
    'conformal.calibrated_result',
    'robustness.summary',
    'tuning.summary',
    'tuning.ordered_search_space',
    'keyword.registry',
  ]);
  assert.deepEqual(
    manifest.artifactContracts.find((item) => item.id === 'conformal.calibrated_result').optionalPayloadFields,
    ['conformal_guarantee_status', 'calibration_replay_source', 'tuning_calibration_source'],
  );
  assert.deepEqual(
    manifest.artifactContracts.find((item) => item.id === 'robustness.summary').optionalPayloadFields,
    ['conformal_guarantee_status', 'spectral_replay'],
  );
  assert.deepEqual(
    manifest.artifactContracts.find((item) => item.id === 'tuning.summary').optionalPayloadFields,
    ['sampler', 'pruner', 'seed', 'persistence', 'trials[*].diagnostics'],
  );
  assert.equal(
    manifest.artifactContracts.find((item) => item.id === 'tuning.ordered_search_space').schema,
    'https://nirs4all.org/schemas/tuning-ordered-search-space/v1',
  );
  assert.deepEqual(
    manifest.artifactContracts.find((item) => item.id === 'tuning.ordered_search_space').requiredRegistryEntries,
    ['run.tuning.space', 'run.tuning.force_params'],
  );
  assert.match(
    manifest.artifactContracts.find((item) => item.id === 'tuning.ordered_search_space').pythonSurface,
    /inspect_tuning_space/,
  );
  assert.deepEqual(requiredKeywordRegistryEntries, [
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
  assert.deepEqual(
    manifest.artifactContracts.find((item) => item.id === 'keyword.registry').requiredRegistryEntries,
    requiredKeywordRegistryEntries,
  );
  assert.match(
    manifest.artifactContracts.find((item) => item.id === 'keyword.registry').pythonSurface,
    /TUNING_OPTIMIZER_PERSISTENCE_KEYS/,
  );
  assert.match(
    manifest.artifactContracts.find((item) => item.id === 'keyword.registry').pythonSurface,
    /ROBUSTNESS_SCENARIO_KINDS/,
  );
  assert.match(
    manifest.artifactContracts.find((item) => item.id === 'keyword.registry').pythonSurface,
    /ROBUSTNESS_SCENARIO_DISTRIBUTIONS/,
  );
  assert.match(
    manifest.artifactContracts.find((item) => item.id === 'keyword.registry').pythonSurface,
    /ROBUSTNESS_MODES/,
  );
  assert.match(
    manifest.artifactContracts.find((item) => item.id === 'keyword.registry').pythonSurface,
    /ROBUSTNESS_EXECUTABLE_MODES/,
  );
  assert.deepEqual(
    manifest.artifactContracts.find((item) => item.id === 'keyword.registry').publishedConstants,
    { ROBUSTNESS_SCENARIO_DISTRIBUTIONS: ['normal', 'uniform'] },
  );
  assert.deepEqual(
    manifest.runtimeContracts.filter((item) => item.serializedModelPredict).map((item) => item.surface),
    ['javascript_wasm'],
  );
  assert.equal(
    manifest.runtimeContracts.find((item) => item.surface === 'javascript_wasm').predictEntrypoint,
    'predictPortablePipeline',
  );
  assert.deepEqual(manifest.portableOperatorClasses.sort(), [...portableOperatorClasses].sort());

  const ids = manifest.controllers.map((item) => item.id);
  assert.deepEqual(ids, [
    'split.kennard_stone',
    'preprocess.snv',
    'preprocess.savgol',
    'model.pls_regression',
    'pipeline.portable_methods',
  ]);

  for (const controller of manifest.controllers) {
    assert.equal(controller.domain, 'methods');
    assert.deepEqual(Object.keys(controller.runtime).sort(), [...runtimeSurfaces].sort());
    assert.ok(Object.values(controller.runtime).every((level) => level === 'parity-validated'));
    assert.ok(controller.ports.inputs.length > 0);
    assert.ok(controller.ports.outputs.length > 0);
  }

  const covered = manifest.controllers.flatMap((item) => item.operatorClasses);
  assert.deepEqual(covered.sort(), [...portableOperatorClasses].sort());
});

test('public upstream loaders map to the declared V1 upstreams', () => {
  assert.equal(typeof loadFormats, 'function');
  assert.equal(typeof loadIo, 'function');
  assert.equal(typeof loadDatasets, 'function');
  assert.equal(typeof loadMethods, 'function');
  assert.equal(typeof loadDagMl, 'function');
  assert.equal(typeof loadDagMlData, 'function');
  assert.equal(typeof loadMethodsWasm, 'function');
  assert.equal(typeof loadDagMlWasm, 'function');
  assert.equal(typeof loadDagMlDataWasm, 'function');
  assert.equal(typeof loadDatasetsWasm, 'function');
  assert.equal(typeof loadDataIoWasm, 'function');
});

test('local implementation registry delegates to the DAG-ML constructor', async () => {
  class Registry {
    register_loss() {}
    register_metric() {}
    bind_training_loss() {}
  }
  const registry = await localImplementationRegistry({ LocalImplementationRegistry: Registry });
  assert.ok(registry instanceof Registry);
  assert.equal(typeof registry.register_loss, 'function');
  assert.equal(typeof registry.register_metric, 'function');
  assert.equal(typeof registry.bind_training_loss, 'function');
});

test('local implementation registry rejects an old DAG-ML module', async () => {
  await assert.rejects(
    () => localImplementationRegistry({}),
    /does not expose LocalImplementationRegistry.*upgrade dag-ml-wasm/s,
  );
});

test('local implementation registry rejects an old registry surface', async () => {
  class Registry {}
  await assert.rejects(
    () => localImplementationRegistry({ LocalImplementationRegistry: Registry }),
    /does not expose register_loss, register_metric, bind_training_loss.*upgrade dag-ml-wasm/s,
  );
});

test('public upstream loaders report the correct missing upstream', async () => {
  await assert.rejects(loadFormats, /upstream 'formats'.*@nirs4all\/formats-wasm/s);
  await assert.rejects(loadIo, /upstream 'io'.*@nirs4all\/io-wasm/s);
  await assert.rejects(loadDatasets, /upstream 'datasets'.*@nirs4all\/datasets-wasm/s);
  await assert.rejects(loadMethods, /upstream 'methods'.*@nirs4all\/methods/s);
  await assert.rejects(loadDagMl, /upstream 'dag_ml'.*dag-ml-wasm/s);
  await assert.rejects(loadDagMlData, /upstream 'dag_ml_data'.*dag-ml-data-wasm/s);
});

test('upstream imports fail explicitly when optional wasm packages are absent', async () => {
  await assert.rejects(() => importUpstream('missing'), /Unknown nirs4all upstream/);
  await assert.rejects(() => methods.import(), /nirs4all upstream 'methods' is not installed/);
  await assert.rejects(() => loadPortableStack(['methods']), /nirs4all upstream 'methods' is not installed/);
});

test('nirs4all JSON and YAML pipeline syntax normalize to the same portable definition', () => {
  const jsonPipeline = loadPipelineDefinition(readFileSync(fixtureUrl, 'utf8'));
  const yamlPipeline = loadPipelineDefinition(readFileSync(yamlFixtureUrl, 'utf8'));

  assert.deepEqual(jsonPipeline, yamlPipeline);
  assert.deepEqual(
    portableClassNames(jsonPipeline),
    [
      'nirs4all.operators.splitters.KennardStoneSplitter',
      'nirs4all.operators.transforms.StandardNormalVariate',
      'nirs4all.operators.transforms.SavitzkyGolay',
      'sklearn.cross_decomposition.PLSRegression',
    ],
  );
  assert.deepEqual(jsonPipeline.pipeline.at(-1)._range_, [2, 11, 2]);
});

test('all shared parity fixtures keep JSON and YAML in lockstep', () => {
  const fixtureDir = new URL('../../../tests/parity/fixtures/', import.meta.url);
  const names = readdirSync(fixtureDir)
    .filter((name) => name.startsWith('portable_') && name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();

  assert.ok(names.length >= 4);
  for (const name of names) {
    const jsonPipeline = loadPipelineDefinition(readFileSync(new URL(`${name}.json`, fixtureDir), 'utf8'));
    const yamlPipeline = loadPipelineDefinition(readFileSync(new URL(`${name}.yaml`, fixtureDir), 'utf8'));
    assert.deepEqual(jsonPipeline, yamlPipeline);
    assert.ok(portableClassNames(jsonPipeline).length > 0);
  }
});

test('steps alias and direct arrays match the nirs4all loader surface', () => {
  const definition = loadPipelineDefinition(readFileSync(fixtureUrl, 'utf8'));

  assert.deepEqual(loadPipelineDefinition({ steps: definition.pipeline }).pipeline, definition.pipeline);
  assert.deepEqual(loadPipelineDefinition(definition.pipeline).pipeline, definition.pipeline);
});
