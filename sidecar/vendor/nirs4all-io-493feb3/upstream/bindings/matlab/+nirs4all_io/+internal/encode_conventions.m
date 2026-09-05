% SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
function json = encode_conventions(conventions)
  % ENCODE_CONVENTIONS  Conventions (cellstr / string / char / []) -> JSON char.
  %
  % An empty value -> '' (the C ABI treats an empty conventions arg as "use the
  % default convention list"). Otherwise a JSON array of strings.
  if nargin < 1 || isempty(conventions)
    json = '';
    return;
  end
  if ischar(conventions)
    conventions = {conventions};
  elseif isstring(conventions)
    conventions = cellstr(conventions);
  end
  if ~iscellstr(conventions)
    error('n4io:arg', 'conventions must be a cellstr / string array / char, or empty');
  end
  json = jsonencode(conventions);
end
