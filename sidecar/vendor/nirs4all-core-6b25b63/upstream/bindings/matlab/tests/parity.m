function parity()
scriptDir = fileparts(mfilename('fullpath'));
root = fileparts(fileparts(fileparts(fileparts(scriptDir))));
addpath(fullfile(scriptDir, '..'));

methodsPath = getenv('NIRS4ALL_METHODS_MATLAB_PATH');
if isempty(methodsPath)
    candidate = fullfile(root, '..', 'nirs4all-methods', 'bindings', 'matlab');
    if exist(candidate, 'dir') == 7
        methodsPath = candidate;
    end
end
if ~isempty(methodsPath) && exist(methodsPath, 'dir') == 7
    addpath(methodsPath);
end

strict = strcmp(getenv('NIRS4ALL_CORE_REQUIRE_METHODS_PARITY'), '1');
if isempty(which('n4m.pls_fit'))
    if strict
        error('nirs4all:testFailed', 'n4m MATLAB/Octave binding is required for strict parity');
    end
    disp('Skipping MATLAB/Octave execution parity: n4m is not on the path');
    return
end

oraclePath = getenv('NIRS4ALL_CORE_PARITY_ORACLE');
if isempty(oraclePath)
    oraclePath = fullfile(root, 'tests', 'parity', 'expected', 'portable_python_oracle.json');
end
fixtureRoot = getenv('NIRS4ALL_CORE_PARITY_FIXTURES');
if isempty(fixtureRoot)
    fixtureRoot = fullfile(root, 'tests', 'parity', 'fixtures');
end

if exist(oraclePath, 'file') ~= 2
    if strict
        error('nirs4all:testFailed', 'portable parity oracle not found: %s', oraclePath);
    end
    disp('Skipping MATLAB/Octave execution parity: oracle is not available');
    return
end

oracle = readJson(oraclePath);
dataset = struct( ...
    'X', oracle.dataset.X, ...
    'y', oracle.dataset.y, ...
    'rows', oracle.dataset.rows, ...
    'cols', oracle.dataset.cols);
cases = asCell(oracle.cases);
tolerances = oracle.metadata.tolerances;
assert(numel(cases) >= 4);

modeFixture = struct();
modeFixture.name = 'savgol_mode_contract';
modeFixture.pipeline = { ...
    struct( ...
        'class', 'nirs4all.operators.transforms.SavitzkyGolay', ...
        'params', struct('window_length', 11, 'mode', 'constant', 'cval', 7.25)), ...
    struct( ...
        'model', struct( ...
            'class', 'sklearn.cross_decomposition.PLSRegression', ...
            'params', struct('n_components', 2))) ...
};
modeResult = nirs4all.runPortablePipeline(modeFixture, dataset);
modeParams = modeResult.preprocessing{1}.params;
assert(isequal(double(modeParams(:)).', [11, 3, 0, 1, 7.25]));

for idx = 1:numel(cases)
    expected = cases{idx};
    fixture = fullfile(fixtureRoot, [expected.name '.json']);
    assert(exist(fixture, 'file') == 2);
    actual = nirs4all.runPortablePipeline(fixture, dataset);

    assert(strcmp(actual.split.kind, expected.split.kind));
    assert(isequal(double(actual.split.trainIndices(:)), double(expected.split.trainIndices(:))));
    assert(isequal(double(actual.split.testIndices(:)), double(expected.split.testIndices(:))));
    assert(maxAbsDiff(actual.targets, expected.targets) <= tolerances.targets_abs);

    expectedVariants = asCell(expected.variants);
    assert(numel(actual.variants) == numel(expectedVariants));
    for variantIdx = 1:numel(expectedVariants)
        actualVariant = actual.variants{variantIdx};
        expectedVariant = expectedVariants{variantIdx};
        assert(double(actualVariant.n_components) == double(expectedVariant.n_components));
        assert(abs(actualVariant.rmse - expectedVariant.rmse) <= tolerances.rmse_abs);
        assert(maxAbsDiff(actualVariant.predictions, expectedVariant.predictions) <= tolerances.predictions_abs);
    end
    assert(double(actual.selected.n_components) == double(expected.selected.n_components));
end

disp('nirs4all MATLAB/Octave execution parity passed');
end

function data = readJson(path)
fid = fopen(path, 'r');
txt = fread(fid, Inf, 'uint8=>char')';
fclose(fid);
data = jsondecode(txt);
end

function cells = asCell(value)
if iscell(value)
    cells = value;
elseif isstruct(value)
    cells = num2cell(value);
else
    error('nirs4all:testFailed', 'expected JSON list value');
end
end

function diff = maxAbsDiff(actual, expected)
a = double(actual(:));
e = double(expected(:));
assert(numel(a) == numel(e));
if isempty(a)
    diff = 0;
else
    diff = max(abs(a - e));
end
end
