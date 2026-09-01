% SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
% Build the n4io MEX against the prebuilt nirs4all-io-capi cdylib.
% Set the env vars first (build_and_test.sh does this):
%   N4IO_INCLUDE  -> dir containing nirs4all_io.h
%   N4IO_CAPI_DIR -> dir containing libnirs4all_io_capi.{so,dylib,dll}
% Works in both MATLAB and Octave (mex is provided by both).
inc = getenv('N4IO_INCLUDE');
libdir = getenv('N4IO_CAPI_DIR');
here = fileparts(mfilename('fullpath'));
src = fullfile(here, 'n4io.c');
mex(src, ...
    ['-I' inc], ...
    ['-L' libdir], '-lnirs4all_io_capi', ...
    ['-Wl,-rpath,' libdir], ...
    '-output', fullfile(here, 'n4io'));
