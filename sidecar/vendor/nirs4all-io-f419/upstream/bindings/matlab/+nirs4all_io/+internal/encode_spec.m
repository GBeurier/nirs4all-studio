% SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
function json = encode_spec(spec)
  % ENCODE_SPEC  Encode a DatasetSpec struct while preserving JSON arrays.
  %
  % Octave decodes one-element JSON object arrays as scalar structs. Without
  % restoring the known spec array fields, jsonencode turns sources/columns back
  % into objects and the Rust C ABI sees an empty DatasetSpec.
  json = encode_value(spec, '');
end

function json = encode_value(value, field_name)
  if isstruct(value)
    if isempty(value)
      if is_array_field(field_name)
        json = '[]';
      else
        json = '{}';
      end
    elseif is_array_field(field_name) && should_encode_as_array(value, field_name)
      parts = cell(1, numel(value));
      for i = 1:numel(value)
        parts{i} = encode_object(value(i));
      end
      json = ['[' join_json(parts) ']'];
    elseif numel(value) > 1
      parts = cell(1, numel(value));
      for i = 1:numel(value)
        parts{i} = encode_object(value(i));
      end
      json = ['[' join_json(parts) ']'];
    else
      json = encode_object(value);
    end
  elseif iscell(value)
    parts = cell(1, numel(value));
    for i = 1:numel(value)
      if is_array_field(field_name)
        parts{i} = encode_value(value{i}, '');
      else
        parts{i} = encode_value(value{i}, field_name);
      end
    end
    json = ['[' join_json(parts) ']'];
  else
    json = jsonencode(value);
  end
end

function json = encode_object(s)
  names = fieldnames(s);
  parts = cell(1, numel(names));
  for j = 1:numel(names)
    name = names{j};
    parts{j} = [jsonencode(name) ':' encode_value(s.(name), name)];
  end
  json = ['{' join_json(parts) '}'];
end

function tf = is_array_field(name)
  tf = any(strcmp(name, {'sources', 'columns', 'variations', 'inline'}));
end

function tf = should_encode_as_array(value, field_name)
  if isempty(value)
    tf = true;
    return;
  end
  if strcmp(field_name, 'columns')
    names = fieldnames(value);
    tf = any(strcmp(names, 'role')) && any(strcmp(names, 'select'));
  else
    tf = true;
  end
end

function out = join_json(parts)
  out = '';
  for i = 1:numel(parts)
    if i > 1
      out = [out ',']; %#ok<AGROW>
    end
    out = [out parts{i}]; %#ok<AGROW>
  end
end
