% SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
function out = summary(obj)
  % SUMMARY  Readable overview of a plan or spec struct.
  %
  %   nirs4all_io.summary(plan)   % scored decisions + overall_score
  %   nirs4all_io.summary(spec)   % name, schema_version, sources
  %   s = nirs4all_io.summary(obj) % also returns the lines as a char
  %
  % Detects a plan (has a resolved_spec field) vs a spec (has sources) and
  % prints accordingly. With no output argument it prints to the console.
  if ~isstruct(obj)
    error('n4io:arg', 'summary expects a plan or spec struct');
  end
  if isfield(obj, 'resolved_spec') || isfield(obj, 'overall_score')
    lines = plan_lines(obj);
  elseif isfield(obj, 'sources') || isfield(obj, 'schema_version')
    lines = spec_lines(obj);
  else
    lines = {'<n4io struct> (unrecognized shape)'};
  end
  text = strjoin(lines, sprintf('\n'));
  if nargout > 0
    out = text;
  else
    disp(text);
  end
end

function lines = plan_lines(plan)
  if isfield(plan, 'overall_score')
    score = num2str(plan.overall_score);
  else
    score = 'NA';
  end
  lines = {sprintf('<n4io plan> overall_score=%s', score)};
  % Scored decisions: any field whose value is a struct carrying value+score.
  names = fieldnames(plan);
  for i = 1:numel(names)
    k = names{i};
    v = plan.(k);
    if is_decision(v)
      amb = '';
      if isfield(v, 'ambiguous') && islogical_true(v.ambiguous)
        amb = ' (ambiguous)';
      end
      lines{end+1} = sprintf('  %-12s %-18s score=%s%s', ...
        k, to_text(v.value), num2str(v.score), amb); %#ok<AGROW>
    end
  end
  if isfield(plan, 'recommendations') && ~isempty(plan.recommendations)
    lines{end+1} = 'recommendations:'; %#ok<AGROW>
    recs = cellstr_field(plan.recommendations);
    for i = 1:numel(recs)
      lines{end+1} = ['  - ' recs{i}]; %#ok<AGROW>
    end
  end
  if isfield(plan, 'warnings') && ~isempty(plan.warnings)
    lines{end+1} = 'warnings:'; %#ok<AGROW>
    warns = cellstr_field(plan.warnings);
    for i = 1:numel(warns)
      lines{end+1} = ['  - ' warns{i}]; %#ok<AGROW>
    end
  end
end

function lines = spec_lines(spec)
  name = field_or(spec, 'name', '<unnamed>');
  sv = field_or(spec, 'schema_version', NaN);
  sources = field_or(spec, 'sources', {});
  if isstruct(sources)
    n = numel(sources);
  else
    n = numel(sources);
  end
  lines = {sprintf('<n4io spec> name=%s schema_version=%s sources=%d', ...
    to_text(name), num2str(sv), n)};
  for i = 1:n
    s = elem(sources, i);
    lines{end+1} = sprintf('  %-10s role=%-9s partition=%-8s input=%s', ...
      to_text(field_or(s, 'id', '?')), to_text(field_or(s, 'role', '?')), ...
      to_text(field_or(s, 'partition', '-')), to_text(field_or(s, 'input', '?'))); %#ok<AGROW>
  end
end

% --- helpers -------------------------------------------------------------------

function tf = is_decision(v)
  tf = isstruct(v) && isfield(v, 'value') && isfield(v, 'score') && isfield(v, 'ambiguous');
end

function tf = islogical_true(x)
  tf = (islogical(x) && any(x(:))) || (isnumeric(x) && any(x(:) ~= 0));
end

function s = to_text(v)
  if ischar(v)
    s = v;
  elseif isstring(v)
    s = char(v);
  elseif isnumeric(v) && isscalar(v)
    s = num2str(v);
  elseif islogical(v) && isscalar(v)
    if v, s = 'true'; else, s = 'false'; end
  else
    s = '<...>';
  end
end

function v = field_or(s, name, default)
  if isstruct(s) && isfield(s, name)
    v = s.(name);
  else
    v = default;
  end
end

function e = elem(arr, i)
  if iscell(arr)
    e = arr{i};
  elseif isstruct(arr)
    e = arr(i);
  else
    e = arr;
  end
end

function c = cellstr_field(v)
  % jsondecode yields a cellstr for a heterogeneous list or a char for one item.
  if ischar(v)
    c = {v};
  elseif iscell(v)
    c = cellfun(@to_text, v, 'UniformOutput', false);
  elseif isstring(v)
    c = cellstr(v);
  else
    c = {to_text(v)};
  end
end
