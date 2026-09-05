% SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
% Smoke test for the MATLAB/Octave binding. Assumes the `n4io` mex is on the path
% (run from bindings/matlab after build.m) and N4IO_CORPUS is set.
corpus = getenv('N4IO_CORPUS');
assert(~isempty(corpus), 'N4IO_CORPUS not set');

json_path = @(p) ['"' p '"'];

% to_spec on train_test -> canonical spec with schema_version.
spec = n4io('to_spec', json_path(fullfile(corpus, 'train_test')));
assert(~isempty(strfind(spec, '"schema_version"')), 'spec missing schema_version'); %#ok<STREMP>

% the produced spec validates.
n4io('validate', spec);

% infer returns a plan.
plan = n4io('infer', json_path(fullfile(corpus, 'single_combined')));
assert(~isempty(strfind(plan, '"resolved_spec"')), 'plan missing resolved_spec'); %#ok<STREMP>

load_json = n4io('load_summary', json_path(fullfile(corpus, 'train_test')));
assert(~isempty(strfind(load_json, '"assembled_schema_version": 2')), 'summary missing schema version'); %#ok<STREMP>

% a bad spec is rejected.
rejected = false;
try
  n4io('validate', '{"partitions": {"by": "random"}}');
catch
  rejected = true;
end
assert(rejected, 'bad spec was not rejected');

assert(~isempty(n4io('abi_version')), 'empty abi_version');

% --- idiomatic layer (nirs4all_io.*) ------------------------------------------
% These accept native MATLAB/Octave inputs and return decoded structs. The
% +nirs4all_io package directory must be on the path (its PARENT must be added,
% e.g. addpath(fileparts(pwd)) when running from bindings/matlab, or build.m's
% dir). smoke.m is run with --path "$(pwd)" so the package is visible here.

% to_spec on a char path -> a struct with schema_version and sources.
sp = nirs4all_io.to_spec(fullfile(corpus, 'train_test'));
assert(isstruct(sp), 'to_spec did not return a struct');
assert(isfield(sp, 'schema_version') && sp.schema_version == 1, 'spec missing schema_version');
assert(isfield(sp, 'sources') && ~isempty(sp.sources), 'spec missing sources');

% the struct round-trips through validate.
assert(nirs4all_io.validate(sp) == true, 'valid spec rejected');

% infer on a char path -> a plan struct with resolved_spec + scored decisions.
pl = nirs4all_io.infer(fullfile(corpus, 'single_combined'));
assert(isstruct(pl) && isfield(pl, 'resolved_spec'), 'plan missing resolved_spec');
assert(isfield(pl, 'structure') && isfield(pl.structure, 'value'), 'plan missing scored decisions');

% summary renders both without error and returns char when asked.
s1 = nirs4all_io.summary(pl);
assert(ischar(s1) && ~isempty(strfind(s1, 'plan')), 'plan summary failed'); %#ok<STREMP>
s2 = nirs4all_io.summary(sp);
assert(ischar(s2) && ~isempty(strfind(s2, 'spec')), 'spec summary failed'); %#ok<STREMP>

% the plan's resolved_spec validates as a struct.
assert(nirs4all_io.validate(pl.resolved_spec) == true, 'resolved_spec rejected');

% a cellstr file list is accepted natively.
flist = {fullfile(corpus, 'x_y_separate', 'X.csv'), fullfile(corpus, 'x_y_separate', 'Y.csv')};
fpl = nirs4all_io.infer(flist);
assert(isstruct(fpl) && isfield(fpl, 'resolved_spec'), 'file-list infer failed');

lsum = nirs4all_io.load_summary(fullfile(corpus, 'train_test'));
assert(isstruct(lsum) && lsum.assembled_schema_version == 2, 'idiomatic load_summary failed');
assert(isequal(lsum, nirs4all_io.load_summary(fullfile(corpus, 'train_test'), [], 'unlimited')));
limited = false;
try
  nirs4all_io.load_summary(fullfile(corpus, 'train_test'), [], struct('max_file_bytes', 1));
catch
  limited = true;
end
assert(limited, 'host read limits were ignored');

% validate rejects a bad spec struct.
bad_struct = struct('partitions', struct('by', 'random'));
rejected2 = false;
try
  nirs4all_io.validate(bad_struct);
catch
  rejected2 = true;
end
assert(rejected2, 'bad spec struct was not rejected');

disp('matlab/octave binding smoke OK');
