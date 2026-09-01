% SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
function spec = to_spec(input, conventions)
  % TO_SPEC  Canonical DatasetSpec from a native MATLAB/Octave input.
  %
  %   spec = nirs4all_io.to_spec(input)
  %   spec = nirs4all_io.to_spec(input, conventions)
  %
  % INPUT accepts a native value: a char path ('/data/run'), a cellstr of files
  % ({'a.csv','b.csv'}), or a struct config. It is jsonencoded internally and
  % the canonical DatasetSpec is jsondecoded back into a struct. CONVENTIONS,
  % when given, is a cellstr of convention names.
  %
  % Pass the returned struct to nirs4all_io.validate. The raw JSON surface
  % stays reachable as n4io('to_spec', input_json, ...).
  if nargin < 2, conventions = {}; end
  input_json = nirs4all_io.internal.encode_input(input);
  conv_json = nirs4all_io.internal.encode_conventions(conventions);
  spec = jsondecode(n4io('to_spec', input_json, conv_json));
end
