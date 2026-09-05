# Dataset inspection ownership and limits

`DatasetInspection` is the Rust wizard service for an explicitly authorized
directory. It delegates table decoding and filename conventions to `nirs4all-io`;
non-native formats are selected before reading through the attested library
adapter. No numerical parser or dataset assembly lives in Studio.

The typed API exposes file inspection, folder detection, recursive dataset
discovery, assembled previews and partition statistics. CSV and Parquet inspect
the real table, including datasets larger than 128 rows or 256 features.
Discovery preserves NIR/MIR sources, metadata, fold paths and dataset groups.
`total_scanned_folders` counts inspected candidate folders containing supported
files, not empty directories. A detected dataset owns its subtree.

Header detection is a proposal with confidence, not proof that the first line
is a header. Small target files, all-text metadata and numeric wavelength headers
can be ambiguous. Explicit `has_header` overrides the proposal before reading;
the response exposes the effective options. Compressed CSV uses IO decoding but
currently needs explicit options when its defaults are inappropriate. No retry
with a different parser occurs after a native read failure.

Rust checks canonical paths against the authorized directory, limits inventory
to 4096 entries and applies host file-count and aggregate byte budgets before
folder reads. This is application confinement, not an OS sandbox or a guarantee
against concurrent filesystem replacement. Native file inspection applies the
supplied IO `LoadLimits`. Samples are capped at 1000 rows; presentation
cardinality and escaped string bytes are admitted before JSON duplication.

Assembled preview/statistics delegate to library-owned scientific projections.
They pass the aggregate raw-byte budget and retain reader evidence. The native
library route additionally applies IO defaults; the non-native Excel/MAT route
does not claim native decompression or shape budgets. These distinctions must
remain visible to the host. The attested worker bounds encoded inspection
output to 32 MiB without truncating scientific arrays. Neither output limits nor
generic IO defaults are an assurance that a workload fits available RAM.

Validation: eight focused Rust tests exercise a real 150-by-300 CSV, small
resource limits, path rejection before callbacks, deterministic non-native
dispatch, explicit header corrections, multisource/metadata/fold discovery and
projection delegation. Installed library tests separately exercise real Excel
and native multisource assembly. HTTP/UI wiring and release-artifact closure
are separate integration gates, not established by these unit tests.

## HTTP wizard integration

`dataset_inspection_http::route` snapshots settings and the attested host while
holding the global mutex, then releases it before reading files or invoking the
library. The connection handler preserves its existing access/CORS checks.
Routes cover `detect-files`, `detect-unified`, `detect-files-list`, `scan-folder`,
`detect-format`, `auto-detect`, `validate-files`, `preview`, and linked-dataset
`GET {id}/preview` / `GET {id}/stats`. Individual-file selection inspects only
selected files, preserving their order; unrelated sibling inputs are not read.
The wizard transport admits 256 MiB per input and 512 MiB aggregate raw inputs.
Native decoding limits apply per inspected table. Assembled projections retain
the separate library policy described above.

Explicit header overrides are applied to X, Y and metadata before shape reads.
Plain-text `auto-detect` with `attempt_load=false` uses at most a 64 KiB prefix
and makes no claim about exact row counts. Other formats require their registered
reader for metadata inspection and report this limitation explicitly.

The integration tests include a real localhost HTTP request that reaches native
CSV inspection without any CPython scientific host. Saved catalogue records,
including directly linked data files, are tested for statistics dispatch; an
empty base directory for absolute file selections remains supported. Full
browser qualification and multipart `preview-upload` are separate pending gates.
