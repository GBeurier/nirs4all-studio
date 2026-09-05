function result = runPortablePipeline(source, dataset)
%RUNPORTABLEPIPELINE Execute the portable nirs4all JSON/YAML subset.
%
% This binding delegates numerical work to the +n4m MATLAB/Octave MEX
% wrappers from nirs4all-methods. It does not implement kernels locally.

definition = nirs4all.loadPipelineDefinition(source);
plan = parseExecutionPlan(definition);
if isempty(which('n4m.pls_fit'))
    error('nirs4all:MissingMethods', ...
        'Portable execution requires the nirs4all-methods +n4m MATLAB/Octave binding on the path.');
end

data = coerceDataset(dataset);

split = computeSplit(plan.splitter, data.X);
trainRows = double(split.trainIndices(:)) + 1;
testRows = double(split.testIndices(:)) + 1;

Xtrain = data.X(trainRows, :);
Xtest = data.X(testRows, :);
ytrain = data.y(trainRows, :);
ytest = data.y(testRows, :);

preprocessing = {};
for idx = 1:numel(plan.preprocessing)
    step = plan.preprocessing{idx};
    if strcmp(step.type, 'StandardNormalVariate')
        Xtrain = n4m.snv_transform(Xtrain);
        Xtest = n4m.snv_transform(Xtest);
    elseif strcmp(step.type, 'SavitzkyGolay')
        params = step.params;
        mode = modeFromInt(params(4));
        Xtrain = n4m.savgol_transform( ...
            Xtrain, 'window_length', params(1), 'polyorder', params(2), ...
            'deriv', params(3), 'delta', 1.0, 'mode', mode, 'cval', params(5));
        Xtest = n4m.savgol_transform( ...
            Xtest, 'window_length', params(1), 'polyorder', params(2), ...
            'deriv', params(3), 'delta', 1.0, 'mode', mode, 'cval', params(5));
    else
        error('nirs4all:UnsupportedStep', ...
            'Unsupported portable preprocessing step: %s', step.type);
    end
    preprocessing{end + 1} = step; %#ok<AGROW>
end

variants = {};
for idx = 1:numel(plan.nComponents)
    nComponents = plan.nComponents(idx);
    [coefs, xMean, yMean] = n4m.pls_fit(Xtrain, ytrain, nComponents);
    predictions = predictFromCoefficients(Xtest, coefs, xMean, yMean);
    diff = predictions(:) - ytest(:);
    variants{end + 1} = struct( ... %#ok<AGROW>
        'n_components', int32(nComponents), ...
        'rmse', sqrt(mean(diff .* diff)), ...
        'predictions', predictions(:).' ...
    );
end

bestIdx = 1;
bestRmse = variants{1}.rmse;
for idx = 2:numel(variants)
    if variants{idx}.rmse < bestRmse
        bestIdx = idx;
        bestRmse = variants{idx}.rmse;
    end
end

result = struct();
result.name = definition.name;
result.rows = int32(size(data.X, 1));
result.cols = int32(size(data.X, 2));
result.split = split;
result.preprocessing = preprocessing;
result.variants = variants;
result.selected = variants{bestIdx};
if strcmp(split.kind, 'all')
    evaluationScope = 'training';
else
    evaluationScope = 'selection_validation';
end
result.evaluation = struct('scope', evaluationScope, 'independent_test', false);
result.targets = ytest(:).';
end

function data = coerceDataset(dataset)
if ~isstruct(dataset)
    error('nirs4all:InvalidDataset', 'Portable execution requires a struct dataset.');
end
if ~isfield(dataset, 'X') || ~isfield(dataset, 'y')
    error('nirs4all:InvalidDataset', 'Dataset must contain X and y fields.');
end

X = coerceNumericMatrix(dataset.X, 'X');
if isvector(X)
    rows = getOptionalScalar(dataset, {'rows', 'n_samples'}, 0);
    cols = getOptionalScalar(dataset, {'cols', 'n_features'}, 0);
    if rows <= 0 || cols <= 0
        error('nirs4all:InvalidDataset', 'Flat X requires rows/cols or n_samples/n_features.');
    end
    X = reshape(X, [cols, rows]).';
end
y = coerceNumericMatrix(dataset.y, 'y');
y = y(:);
if size(X, 1) ~= numel(y)
    error('nirs4all:InvalidDataset', ...
        'X rows (%d) must match y rows (%d).', size(X, 1), numel(y));
end
data = struct('X', X, 'y', y);
end

function value = getOptionalScalar(s, names, defaultValue)
value = defaultValue;
for idx = 1:numel(names)
    name = names{idx};
    if isfield(s, name)
        value = double(s.(name));
        return
    end
end
end

function plan = parseExecutionPlan(definition)
splitter = [];
preprocessing = {};
modelStep = [];

for idx = 1:numel(definition.pipeline)
    step = definition.pipeline{idx};
    if ~isstruct(step)
        error('nirs4all:InvalidPipeline', 'Portable pipeline steps must be mapping objects.');
    end
    if ~isempty(modelStep)
        error('nirs4all:InvalidPipeline', 'The model must be the final portable pipeline step.');
    end
    if isfield(step, 'class') && isfield(step, 'model')
        error('nirs4all:InvalidPipeline', 'A portable step cannot contain both class and model.');
    end

    if isfield(step, 'class') && ischar(step.('class'))
        className = step.('class');
        if any(strcmp(className, { ...
                'nirs4all.operators.splitters.KennardStoneSplitter', ...
                'nirs4all.operators.splitters.splitters.KennardStoneSplitter'}))
            if ~isempty(splitter)
                error('nirs4all:InvalidPipeline', 'The optional splitter must appear once, before the model.');
            end
            splitter = struct('type', 'KennardStone', 'params', getFieldOrDefault(step, 'params', struct()));
            splitter.params.test_size = numericParam(getFieldOrDefault(splitter.params, 'test_size', 0.25));
        elseif any(strcmp(className, { ...
                'nirs4all.operators.transforms.SNV', ...
                'nirs4all.operators.transforms.StandardNormalVariate', ...
                'nirs4all.operators.transforms.scalers.StandardNormalVariate'}))
            preprocessing{end + 1} = struct('type', 'StandardNormalVariate', 'params', []); %#ok<AGROW>
        elseif any(strcmp(className, { ...
                'nirs4all.operators.transforms.SavitzkyGolay', ...
                'nirs4all.operators.transforms.nirs.SavitzkyGolay'}))
            preprocessing{end + 1} = struct( ... %#ok<AGROW>
                'type', 'SavitzkyGolay', ...
                'params', savgolParams(getFieldOrDefault(step, 'params', struct())));
        else
            error('nirs4all:UnsupportedOperator', ...
                'Portable execution does not support step class ''%s''.', className);
        end
        continue
    end

    if isfield(step, 'model') && isstruct(step.model)
        if ~isempty(modelStep)
            error('nirs4all:InvalidPipeline', 'Portable execution supports exactly one model step.');
        end
        modelStep = step;
        continue
    end

    error('nirs4all:UnsupportedStep', 'Portable execution does not support pipeline step.');
end

if isempty(modelStep)
    error('nirs4all:InvalidPipeline', 'Portable execution requires a PLSRegression model step.');
end
modelClass = modelStep.model.('class');
if ~any(strcmp(modelClass, { ...
        'sklearn.cross_decomposition.PLSRegression', ...
        'sklearn.cross_decomposition._pls.PLSRegression'}))
    error('nirs4all:UnsupportedOperator', ...
        'Portable execution does not support model class ''%s''.', modelClass);
end

plan = struct( ...
    'splitter', splitter, ...
    'preprocessing', {preprocessing}, ...
    'nComponents', componentValues(modelStep));
end

function split = computeSplit(splitter, X)
if isempty(splitter)
    indices = int32(0:(size(X, 1) - 1));
    split = struct('kind', 'all', 'trainIndices', indices, 'testIndices', indices);
    return
end

params = splitter.params;
testSize = getFieldOrDefault(params, 'test_size', 0.25);
raw = n4m.kennard_stone_split(X, 'test_size', double(testSize), 'zero_based', true);
split = struct( ...
    'kind', 'KennardStone', ...
    'trainIndices', int32(raw.train(:).'), ...
    'testIndices', int32(raw.test(:).'));
end

function params = savgolParams(input)
delta = numericParam(getFieldOrDefault(input, 'delta', 1.0));
if delta ~= 1.0
    error('nirs4all:UnsupportedOperator', ...
        'Portable Savitzky-Golay execution currently supports delta=1 only.');
end
windowLength = getFieldOrDefault(input, 'window_length', []);
if isempty(windowLength)
    windowLength = getFieldOrDefault(input, 'window', 11);
end
params = [ ...
    integerParam(windowLength, 1), ...
    integerParam(getFieldOrDefault(input, 'polyorder', 3), 0), ...
    integerParam(getFieldOrDefault(input, 'deriv', 0), 0), ...
    double(modeToInt(getFieldOrDefault(input, 'mode', 'interp'))), ...
    numericParam(getFieldOrDefault(input, 'cval', 0.0)) ...
];
end

function value = modeToInt(mode)
if isstring(mode)
    mode = char(mode);
end
if ischar(mode)
    switch lower(mode)
        case 'mirror'
            value = 0;
        case 'constant'
            value = 1;
        case 'nearest'
            value = 2;
        case 'wrap'
            value = 3;
        case 'interp'
            value = 4;
        otherwise
            error('nirs4all:UnsupportedOperator', ...
                'Unsupported Savitzky-Golay mode: %s', mode);
    end
    return
end
value = integerParam(mode, 0);
if value < 0 || value > 4 || value ~= fix(value)
    error('nirs4all:UnsupportedOperator', ...
        'Unsupported Savitzky-Golay mode: %g', value);
end
end

function mode = modeFromInt(value)
modes = {'mirror', 'constant', 'nearest', 'wrap', 'interp'};
value = modeToInt(value);
mode = modes{value + 1};
end

function values = componentValues(step)
if isfield(step, '_range_')
    if ~isfield(step, 'param') || ~strcmp(step.param, 'n_components')
        error('nirs4all:InvalidPipeline', ...
            'Portable execution only supports _range_ sweeps over ''n_components''.');
    end
    rawValues = step.('_range_');
    if ~(isnumeric(rawValues) || iscell(rawValues)) || numel(rawValues) ~= 3
        error('nirs4all:InvalidPipeline', ...
            'Invalid n_components _range_; expected [start, stop, positive_step].');
    end
    rangeValues = zeros(1, 3);
    for idx = 1:3
        if iscell(rawValues)
            rangeValues(idx) = integerParam(rawValues{idx}, 1);
        else
            rangeValues(idx) = integerParam(rawValues(idx), 1);
        end
    end
    if rangeValues(1) > rangeValues(2)
        error('nirs4all:InvalidPipeline', 'Invalid n_components _range_; start must be <= stop.');
    end
    count = floor((rangeValues(2) - rangeValues(1)) / rangeValues(3)) + 1;
    if count > 10000
        error('nirs4all:InvalidPipeline', 'Portable n_components sweep exceeds 10000 variants.');
    end
    values = int32(rangeValues(1) + (0:(count - 1)) * rangeValues(3));
    return
end
params = getFieldOrDefault(step.model, 'params', struct());
values = int32(integerParam(getFieldOrDefault(params, 'n_components', 2), 1));
end

function number = numericParam(value)
if isstring(value) && isscalar(value)
    value = char(value);
end
if ischar(value)
    number = str2double(strtrim(value));
elseif isnumeric(value) && isscalar(value) && isreal(value)
    number = double(value);
else
    error('nirs4all:InvalidPipeline', 'Portable numeric parameter must be a finite number.');
end
if ~isscalar(number) || ~isfinite(number)
    error('nirs4all:InvalidPipeline', 'Portable numeric parameter must be finite.');
end
end

function number = integerParam(value, minimum)
number = numericParam(value);
if number ~= fix(number) || number < minimum || number > 2147483647
    error('nirs4all:InvalidPipeline', 'Portable integer parameter must be an integer in %g..2147483647.', minimum);
end
end

function predictions = predictFromCoefficients(X, coefs, xMean, yMean)
centered = bsxfun(@minus, double(X), double(xMean));
predictions = bsxfun(@plus, centered * double(coefs), double(yMean));
end

function out = coerceNumericMatrix(value, label)
if isnumeric(value)
    out = double(value);
    return
end

if iscell(value)
    if isempty(value)
        out = [];
        return
    end
    if isvector(value) && all(cellfun(@(item) isnumeric(item) && isscalar(item), value))
        out = double(cell2mat(value(:))).';
        return
    end

    rows = cell(numel(value), 1);
    widths = zeros(numel(value), 1);
    for idx = 1:numel(value)
        row = value{idx};
        if iscell(row)
            if ~all(cellfun(@(item) isnumeric(item) && isscalar(item), row))
                error('nirs4all:InvalidDataset', ...
                    'Dataset %s contains a non-numeric nested cell value.', label);
            end
            row = double(cell2mat(row(:))).';
        elseif isnumeric(row)
            row = double(row(:)).';
        else
            error('nirs4all:InvalidDataset', ...
                'Dataset %s must contain numeric rows.', label);
        end
        rows{idx} = row;
        widths(idx) = numel(row);
    end
    if any(widths ~= widths(1))
        error('nirs4all:InvalidDataset', ...
            'Dataset %s has ragged rows and cannot be coerced to a matrix.', label);
    end
    out = zeros(numel(rows), widths(1));
    for idx = 1:numel(rows)
        out(idx, :) = rows{idx};
    end
    return
end

error('nirs4all:InvalidDataset', 'Dataset %s must be numeric or a numeric cell array.', label);
end

function value = getFieldOrDefault(s, field, defaultValue)
if isstruct(s) && isfield(s, field)
    value = s.(field);
else
    value = defaultValue;
end
end
