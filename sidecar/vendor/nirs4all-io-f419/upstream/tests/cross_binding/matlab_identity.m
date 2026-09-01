% SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
% IO-XLG-001 runner. Writes only the canonical native summary to the requested
% file so Octave/MATLAB banners cannot contaminate byte-parity evidence.
spec_path = getenv('N4IO_XLG_SPEC');
output_path = getenv('N4IO_XLG_OUTPUT');
assert(~isempty(spec_path), 'N4IO_XLG_SPEC not set');
assert(~isempty(output_path), 'N4IO_XLG_OUTPUT not set');
summary_json = n4io('load_summary', jsonencode(spec_path));
fid = fopen(output_path, 'w');
assert(fid >= 0, 'cannot open N4IO_XLG_OUTPUT');
cleanup = onCleanup(@() fclose(fid));
fwrite(fid, summary_json, 'char');
