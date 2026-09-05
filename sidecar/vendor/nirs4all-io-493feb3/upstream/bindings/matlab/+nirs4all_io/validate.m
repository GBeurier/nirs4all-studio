% SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
function ok = validate(spec)
  % VALIDATE  Validate a DatasetSpec; errors if invalid.
  %
  %   ok = nirs4all_io.validate(spec)
  %
  % SPEC accepts a struct (as returned by nirs4all_io.to_spec) or a JSON char.
  % Returns logical true on success; raises an error (n4io:error) otherwise.
  %
  % The raw JSON surface stays reachable as n4io('validate', spec_json).
  if ischar(spec) || isstring(spec)
    spec_json = char(spec);
  elseif isstruct(spec)
    spec_json = nirs4all_io.internal.encode_spec(spec);
  else
    error('n4io:arg', 'spec must be a struct or a JSON char');
  end
  n4io('validate', spec_json);
  ok = true;
end
