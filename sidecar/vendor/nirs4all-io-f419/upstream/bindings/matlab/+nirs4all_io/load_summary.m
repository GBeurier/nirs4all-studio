% SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
function summary = load_summary(input, conventions)
  % LOAD_SUMMARY  Materialize input and return the native structural summary.
  %
  % The v0 wire exposes shapes, rounded values, source ids, scientific
  % identity, and fold provenance; it intentionally does not expose raw arrays.
  if nargin < 2, conventions = {}; end
  input_json = nirs4all_io.internal.encode_input(input);
  conv_json = nirs4all_io.internal.encode_conventions(conventions);
  summary = jsondecode(n4io('load_summary', input_json, conv_json));
end
