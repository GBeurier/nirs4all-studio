% SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
function json = encode_input(input)
  % ENCODE_INPUT  Native MATLAB/Octave input -> the JSON value the C ABI takes.
  %
  % A char/string path -> a quoted JSON string; a cellstr of files -> a JSON
  % array; a struct config/spec -> a JSON object. Already-encoded JSON char is
  % accepted only when it is itself a struct/array/quoted-string (i.e. you may
  % pass a struct directly instead of a hand-written JSON string).
  if isstruct(input)
    json = nirs4all_io.internal.encode_spec(input);
  elseif iscellstr(input) || (isstring(input) && numel(input) > 1)
    json = jsonencode(cellstr(input));
  elseif ischar(input) || (isstring(input) && isscalar(input))
    % A scalar path. jsonencode quotes it into a JSON string value, which is
    % exactly the C ABI path form (e.g. '/data/run' -> "/data/run").
    json = jsonencode(char(input));
  else
    error('n4io:arg', ...
      'input must be a char path, a cellstr of files, or a struct config');
  end
end
