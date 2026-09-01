addpath(fullfile(fileparts(mfilename('fullpath')), '..'));

items = nirs4all.upstreams();
assert(numel(items) == 6);
assert(strcmp(items(1).key, 'dag_ml'));
method_item = nirs4all.requireUpstream('methods');
assert(strcmp(method_item.key, 'methods'));
dag_ml_item = nirs4all.requireUpstream('dag_ml');
assert(strcmp(dag_ml_item.package, '+dagml'));

dag_ml_path = getenv('NIRS4ALL_DAG_ML_MATLAB_PATH');
if ~isempty(dag_ml_path)
    addpath(dag_ml_path);
    registry = nirs4all.localImplementationRegistry();
    assert(isa(registry, 'dagml.LocalImplementationRegistry'));
    registryMethods = methods(registry);
    assert(any(strcmp(registryMethods, 'registerLoss')));
    assert(any(strcmp(registryMethods, 'registerMetric')));
    assert(any(strcmp(registryMethods, 'invokeTrainingLoss')));
    assert(registry.count() == 0);
end

manifest = nirs4all.capabilityManifest();
assert(strcmp(manifest.schema, 'nirs4all-core.capabilities.v1'));
assert(isequal(nirs4all.runtimeSurfaces(), {'python', 'r', 'javascript_wasm', 'rust', 'matlab_octave'}));
contracts = nirs4all.runtimeContracts();
assert(isequal(manifest.runtimeContracts, contracts));
contractSurfaces = cellfun(@(item) item.surface, contracts, 'UniformOutput', false);
assert(isequal(contractSurfaces, {'python', 'r', 'javascript_wasm', 'rust', 'matlab_octave'}));
predictFlags = cellfun(@(item) item.serializedModelPredict, contracts);
assert(isequal(predictFlags, [false, false, true, false, false]));
controllers = nirs4all.controllerCapabilities();
controllerIds = cellfun(@(item) item.id, controllers, 'UniformOutput', false);
assert(isequal(controllerIds, { ...
    'split.kennard_stone', ...
    'preprocess.snv', ...
    'preprocess.savgol', ...
    'model.pls_regression', ...
    'pipeline.portable_methods' ...
}));
covered = {};
for controllerIdx = 1:numel(controllers)
    covered = [covered, controllers{controllerIdx}.operatorClasses]; %#ok<AGROW>
end
assert(isequal(covered, nirs4all.portableOperatorClasses()));

artifactContracts = nirs4all.artifactContracts();
artifactIds = cellfun(@(item) item.id, artifactContracts, 'UniformOutput', false);
assert(isequal(artifactIds, {'conformal.calibrated_result', 'robustness.summary', 'tuning.summary', 'tuning.ordered_search_space', 'keyword.registry'}));
robustnessContract = artifactContracts{strcmp(artifactIds, 'robustness.summary')};
conformalContract = artifactContracts{strcmp(artifactIds, 'conformal.calibrated_result')};
assert(isequal(conformalContract.optionalPayloadFields, {'conformal_guarantee_status', 'calibration_replay_source', 'tuning_calibration_source'}));
assert(isequal(robustnessContract.optionalPayloadFields, {'conformal_guarantee_status', 'spectral_replay'}));
tuningContract = artifactContracts{strcmp(artifactIds, 'tuning.summary')};
assert(isequal(tuningContract.optionalPayloadFields, {'sampler', 'pruner', 'seed', 'persistence', 'trials[*].diagnostics'}));
orderedTuningContract = artifactContracts{strcmp(artifactIds, 'tuning.ordered_search_space')};
assert(strcmp(orderedTuningContract.schema, 'https://nirs4all.org/schemas/tuning-ordered-search-space/v1'));
assert(strcmp(orderedTuningContract.portableClaim, 'search-space-json-contract-only'));
assert(isequal(orderedTuningContract.requiredRegistryEntries, {'run.tuning.space', 'run.tuning.force_params'}));
keywordContract = artifactContracts{strcmp(artifactIds, 'keyword.registry')};
requiredEntries = { ...
    'run.tuning', ...
    'run.tuning.engine', ...
    'run.tuning.space', ...
    'run.tuning.force_params', ...
    'run.tuning.score_data', ...
    'run.tuning.score_data.conformal_calibration', ...
    'predict.coverage', ...
    'predict.all_predictions', ...
    'robustness.scenarios.kind', ...
    'robustness.scenarios.severity', ...
    'robustness.scenarios.distribution', ...
    'robustness.X', ...
    'robustness.predictor', ...
    'robustness.predictor_bundle' ...
};
assert(isequal(nirs4all.requiredKeywordRegistryEntries(), requiredEntries));
assert(isequal(keywordContract.requiredRegistryEntries, requiredEntries));
assert(isequal(keywordContract.publishedConstants.ROBUSTNESS_SCENARIO_DISTRIBUTIONS, {'normal', 'uniform'}));

try
    nirs4all.requireUpstream('missing');
    error('nirs4all:testFailed', 'missing upstream should fail');
catch err
    assert(strcmp(err.identifier, 'nirs4all:UnknownUpstream'));
end

fixture_dir = fullfile(fileparts(mfilename('fullpath')), '..', '..', '..', 'tests', 'parity', 'fixtures');
fixture_files = dir(fullfile(fixture_dir, 'portable_*.json'));
assert(numel(fixture_files) >= 4);
for i = 1:numel(fixture_files)
    [~, fixture_name, ~] = fileparts(fixture_files(i).name);
    json_definition = nirs4all.loadPipelineDefinition(fullfile(fixture_dir, [fixture_name '.json']));
    yaml_definition = nirs4all.loadPipelineDefinition(fullfile(fixture_dir, [fixture_name '.yaml']));
    assert(numel(json_definition.pipeline) == numel(yaml_definition.pipeline));
    assert(numel(nirs4all.portableClassNames(json_definition)) > 0);
end

json_pipeline = nirs4all.loadPipelineDefinition(fullfile(fixture_dir, 'portable_methods_pipeline.json'));
yaml_pipeline = nirs4all.loadPipelineDefinition(fullfile(fixture_dir, 'portable_methods_pipeline.yaml'));

expected_classes = { ...
    'nirs4all.operators.splitters.KennardStoneSplitter', ...
    'nirs4all.operators.transforms.StandardNormalVariate', ...
    'nirs4all.operators.transforms.SavitzkyGolay', ...
    'sklearn.cross_decomposition.PLSRegression' ...
};
assert(isequal(nirs4all.portableClassNames(json_pipeline), expected_classes));
assert(isequal(nirs4all.portableClassNames(yaml_pipeline), expected_classes));
assert(numel(json_pipeline.pipeline) == numel(yaml_pipeline.pipeline));

sweep = json_pipeline.pipeline{4};
range = sweep.('_range_');
assert(strcmp(sweep.param, 'n_components'));
assert(isequal(range(:)', [2 11 2]));

from_steps = nirs4all.loadPipelineDefinition(struct('steps', {json_pipeline.pipeline}));
from_list = nirs4all.loadPipelineDefinition(json_pipeline.pipeline);
assert(numel(from_steps.pipeline) == numel(json_pipeline.pipeline));
assert(numel(from_list.pipeline) == numel(json_pipeline.pipeline));

try
    nirs4all.loadPipelineDefinition(struct('pipeline', {{struct('class', 'sklearn.ensemble.RandomForestRegressor')}}));
    error('nirs4all:testFailed', 'unsupported operator should fail');
catch err
    assert(strcmp(err.identifier, 'nirs4all:UnsupportedOperator'));
end

disp('nirs4all MATLAB/Octave smoke passed');
