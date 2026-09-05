% SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
function plan = infer(input, conventions)
  % INFER  Scored dataset plan from a native MATLAB/Octave input.
  %
  %   plan = nirs4all_io.infer(input)
  %   plan = nirs4all_io.infer(input, conventions)
  %
  % INPUT accepts a native value: a char path ('/data/run'), a cellstr of files
  % ({'a.csv','b.csv'}), or a struct config. It is jsonencoded internally and
  % the scored DatasetPlan is jsondecoded back into a struct (not a raw JSON
  % char). CONVENTIONS, when given, is a cellstr of convention names.
  %
  % Use nirs4all_io.summary(plan) for a readable overview, and
  % plan.resolved_spec for the editable spec.
  %
  % The raw JSON surface stays reachable as n4io('infer', input_json, ...).
  if nargin < 2, conventions = {}; end
  input_json = nirs4all_io.internal.encode_input(input);
  conv_json = nirs4all_io.internal.encode_conventions(conventions);
  plan = jsondecode(n4io('infer', input_json, conv_json));
end
