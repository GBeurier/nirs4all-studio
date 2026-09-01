function definition = loadPipelineDefinition(source)
%LOADPIPELINEDEFINITION Load a nirs4all JSON/YAML pipeline definition.

data = parsePipelineSource(source);
data = normalizePipelineRoot(data);

if ~isfield(data, 'pipeline') || ~(iscell(data.pipeline) || isstruct(data.pipeline))
    error('nirs4all:InvalidPipeline', ...
        'Pipeline definition key ''pipeline'' or ''steps'' must contain a list of steps.');
end

pipeline = stripComments(coerceStepList(data.pipeline));
classes = nirs4all.portableClassNames(pipeline);
supported = nirs4all.portableOperatorClasses();
unsupported = {};
for idx = 1:numel(classes)
    if ~any(strcmp(supported, classes{idx})) && ~any(strcmp(unsupported, classes{idx}))
        unsupported{end + 1} = classes{idx}; %#ok<AGROW>
    end
end
if ~isempty(unsupported)
    error('nirs4all:UnsupportedOperator', ...
        'Pipeline uses operators outside the current nirs4all-core portable subset: %s', ...
        strjoin(unsupported, ', '));
end

definition = struct();
definition.name = getFieldOrDefault(data, 'name', 'pipeline');
definition.description = getFieldOrDefault(data, 'description', '');
if isfield(data, 'random_state') && isnumeric(data.random_state)
    definition.random_state = data.random_state;
end
definition.pipeline = pipeline;
end

function steps = coerceStepList(value)
if iscell(value)
    steps = value;
    return
end
if isstruct(value)
    steps = num2cell(value);
    return
end
error('nirs4all:InvalidPipeline', ...
    'Pipeline definition key ''pipeline'' or ''steps'' must contain a list of steps.');
end

function data = parsePipelineSource(source)
if ischar(source)
    path = pathLikeSource(source);
    if ~isempty(path)
        if exist(path, 'file') ~= 2
            error('nirs4all:MissingPipelineFile', 'Configuration file does not exist: %s', path);
        end
        text = fileread(path);
        [~, ~, extension] = fileparts(path);
        data = parsePipelineText(text, lower(extension));
        return
    end
    data = parsePipelineText(source, '');
    return
end

if isstring(source)
    data = parsePipelineSource(char(source));
    return
end

data = source;
end

function path = pathLikeSource(source)
path = '';
if ~isempty(regexp(source, '[\r\n]', 'once'))
    return
end
[~, ~, extension] = fileparts(source);
if any(strcmpi(extension, {'.json', '.yaml', '.yml'})) || exist(source, 'file') == 2
    path = source;
end
end

function data = parsePipelineText(text, extension)
trimmed = strtrim(text);
if strcmp(extension, '.json') || (~isempty(trimmed) && any(trimmed(1) == '[{'))
    data = jsondecode(text);
    return
end

if strcmp(extension, '.yaml') || strcmp(extension, '.yml') || ~isempty(trimmed)
    data = parsePortableYaml(text);
    return
end

error('nirs4all:InvalidPipeline', 'Pipeline definition is empty.');
end

function data = normalizePipelineRoot(data)
if iscell(data)
    data = struct('pipeline', {data});
    return
end

if isstruct(data)
    if numel(data) > 1
        data = struct('pipeline', {num2cell(data)});
        return
    end
    if isfield(data, 'pipeline')
        return
    end
    if isfield(data, 'steps')
        data.pipeline = data.steps;
        return
    end
end

error('nirs4all:InvalidPipeline', ...
    'Invalid pipeline definition format. Expected a list or mapping with a ''pipeline'' or ''steps'' key.');
end

function value = stripComments(value)
if isnumeric(value) && isvector(value)
    value = value(:).';
    return
end

if iscell(value)
    output = {};
    for idx = 1:numel(value)
        item = value{idx};
        if isCommentStep(item)
            continue
        end
        output{end + 1} = stripComments(item); %#ok<AGROW>
    end
    value = output;
    return
end

if isstruct(value)
    for idx = 1:numel(value)
        item = value(idx);
        if isfield(item, '_comment')
            item = rmfield(item, '_comment');
        end
        fields = fieldnames(item);
        for fieldIdx = 1:numel(fields)
            item.(fields{fieldIdx}) = stripComments(item.(fields{fieldIdx}));
        end
        value(idx) = item;
    end
end
end

function yes = isCommentStep(value)
yes = isstruct(value) && numel(value) == 1 && numel(fieldnames(value)) == 1 && isfield(value, '_comment');
end

function value = getFieldOrDefault(data, field, defaultValue)
if isfield(data, field)
    value = data.(field);
    if isstring(value)
        value = char(value);
    end
else
    value = defaultValue;
end
end

function data = parsePortableYaml(text)
lines = regexp(text, '\r\n|\n|\r', 'split');
data = struct();
i = 1;
while i <= numel(lines)
    line = strtrim(lines{i});
    if isempty(line) || line(1) == '#'
        i = i + 1;
        continue
    end

    [key, rawValue] = splitKeyValue(line);
    if strcmp(key, 'pipeline') && isempty(rawValue)
        [pipeline, i] = parseYamlPipeline(lines, i + 1);
        data.pipeline = pipeline;
        continue
    end

    if strcmp(rawValue, '>-')
        [value, i] = parseFoldedBlock(lines, i + 1);
        data.(key) = value;
        continue
    end

    data.(key) = parseYamlScalar(rawValue);
    i = i + 1;
end
end

function [pipeline, i] = parseYamlPipeline(lines, i)
pipeline = {};
while i <= numel(lines)
    raw = lines{i};
    trimmed = strtrim(raw);
    if isempty(trimmed) || trimmed(1) == '#'
        i = i + 1;
        continue
    end
    indent = lineIndent(raw);
    trimmed = strtrim(raw);
    if indent < 2 || numel(trimmed) < 2 || trimmed(1) ~= '-'
        break
    end

    step = struct();
    first = strtrim(trimmed(2:end));
    if ~isempty(first)
        [key, rawValue] = splitKeyValue(first);
        if isempty(rawValue)
            [nested, i] = parseYamlMap(lines, i + 1, indent + 4);
            step.(key) = nested;
        else
            step.(key) = parseYamlScalar(rawValue);
            i = i + 1;
        end
    else
        i = i + 1;
    end

    while i <= numel(lines)
        raw = lines{i};
        trimmed = strtrim(raw);
        if isempty(trimmed)
            i = i + 1;
            continue
        end
        indent = lineIndent(raw);
        if indent < 4 || (indent == 2 && trimmed(1) == '-')
            break
        end
        [key, rawValue] = splitKeyValue(trimmed);
        if isempty(rawValue)
            [nested, i] = parseYamlMap(lines, i + 1, indent + 2);
            step.(key) = nested;
        else
            step.(key) = parseYamlScalar(rawValue);
            i = i + 1;
        end
    end

    pipeline{end + 1} = step; %#ok<AGROW>
end
end

function [map, i] = parseYamlMap(lines, i, expectedIndent)
map = struct();
while i <= numel(lines)
    raw = lines{i};
    trimmed = strtrim(raw);
    if isempty(trimmed)
        i = i + 1;
        continue
    end
    indent = lineIndent(raw);
    if indent < expectedIndent || trimmed(1) == '-'
        break
    end
    [key, rawValue] = splitKeyValue(trimmed);
    map.(key) = parseYamlScalar(rawValue);
    i = i + 1;
end
end

function [value, i] = parseFoldedBlock(lines, i)
parts = {};
while i <= numel(lines)
    raw = lines{i};
    if lineIndent(raw) == 0 && ~isempty(strtrim(raw))
        break
    end
    if ~isempty(strtrim(raw))
        parts{end + 1} = strtrim(raw); %#ok<AGROW>
    end
    i = i + 1;
end
value = strtrim(strjoin(parts, ' '));
end

function [key, value] = splitKeyValue(line)
idx = find(line == ':', 1);
if isempty(idx)
    error('nirs4all:InvalidYaml', 'Invalid YAML line: %s', line);
end
key = strtrim(line(1:idx - 1));
value = strtrim(line(idx + 1:end));
end

function value = parseYamlScalar(raw)
raw = strtrim(raw);
if isempty(raw)
    value = '';
    return
end

if numel(raw) >= 2 && raw(1) == '[' && raw(end) == ']'
    inner = strtrim(raw(2:end - 1));
    if isempty(inner)
        value = [];
        return
    end
    parts = regexp(inner, '\s*,\s*', 'split');
    numbers = str2double(parts);
    if all(~isnan(numbers))
        value = numbers;
    else
        value = parts;
    end
    return
end

if strcmpi(raw, 'true')
    value = true;
    return
end
if strcmpi(raw, 'false')
    value = false;
    return
end

number = str2double(raw);
if ~isnan(number)
    value = number;
    return
end

if numel(raw) >= 2 && ((raw(1) == '''' && raw(end) == '''') || (raw(1) == '"' && raw(end) == '"'))
    raw = raw(2:end - 1);
end
value = raw;
end

function indent = lineIndent(line)
indent = 0;
while indent < numel(line) && line(indent + 1) == ' '
    indent = indent + 1;
end
end
