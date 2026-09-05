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
if ispc
    % MSVC consumes Cargo's import library explicitly. The DLL is copied next
    % to the MEX so the Windows loader finds the exact paired C-ABI runtime.
    imports = {
        fullfile(libdir, 'nirs4all_io_capi.dll.lib'), ...
        fullfile(libdir, 'nirs4all_io_capi.lib') ...
    };
    importlib = '';
    for i = 1:numel(imports)
        if isfile(imports{i})
            importlib = imports{i};
            break;
        end
    end
    if isempty(importlib)
        error('nirs4all_io:build', 'No MSVC import library found in %s', libdir);
    end
    mex(src, ['-I' inc], importlib, '-output', fullfile(here, 'n4io'));
    dll = fullfile(libdir, 'nirs4all_io_capi.dll');
    if ~isfile(dll)
        error('nirs4all_io:build', 'No nirs4all_io_capi.dll found in %s', libdir);
    end
    copyfile(dll, here, 'f');
else
    mex(src, ...
        ['-I' inc], ...
        ['-L' libdir], '-lnirs4all_io_capi', ...
        ['-Wl,-rpath,' libdir], ...
        '-output', fullfile(here, 'n4io'));
end
