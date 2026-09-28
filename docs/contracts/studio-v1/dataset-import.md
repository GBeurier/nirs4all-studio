# Dataset import and metadata

Rust owns `POST /api/datasets/upload`, `/api/datasets/preview-upload`,
`/api/datasets/import-multimodal`, `/api/datasets/link`, and `/api/datasets/{id}/refresh`. Upload and inspection
run outside the global route mutex. No Python HTTP service is started.

Typed multimodal import accepts JSON `{name, dataset_document}` where the
document is the closed `nirs4all.studio-multimodal-dataset.v1` wrapper around
a self-contained `MultimodalDataset.to_dict()` cohort. The browser selects a
JSON file; Rust limits the compact descriptor to 1 MiB, writes its exact
content under workspace `imports/multimodal-*/dataset.json`, and keeps the
containing **directory** as the catalogue path. The attested adapter calls the
published `nirs4all_io.MultimodalDataset.from_dict` contract to validate the
cohort, then projects catalogue counts before the link is published.
The pretty-printed catalogue must also fit within its 2 MiB document limit
with 256 KiB reserved for further links and groups; large inline cohorts are
refused before publication even when their compact JSON is under 1 MiB.
This import neither generates data nor reads external references from the
descriptor. A failed inspection removes the temporary directory and leaves
the catalogue unchanged. The packaged product requires the scientific host;
the optional Python HTTP diagnostic backend does not expose this route.

Multipart uploads contain repeated `files` parts and one JSON `metadata`
part. The legacy preview-only `metadata` query is accepted when the body
does not also contain metadata. Imports use `{config: <wizard config>}`;
previews use `{files, parsing, max_samples?}`. Names must be plain bounded
filenames, unique case-insensitively; every uploaded file must be selected.
File roles and parsing options remain explicit, and content parsing is
delegated to the library/IO readers. No scientific parser is added to Rust.

Admission limits: 64 MiB HTTP body, 256 files, 2 MiB JSON metadata, 256 MiB
per input file and 512 MiB total reader input budget. The separately bounded
scientific response retains its 32 MiB inspection budget. These are not
claims about total process RSS or decompressed allocation size. Oversize or
ambiguous requests return an error, never a silently truncated dataset.

Previews use a fresh temporary directory whose lifetime ends with the
request. Imports use a new directory under the selected workspace's
`imports/` directory. Existing files and symlinked import directories are
never overwritten. Only after successful library inspection is the dataset
linked and its files retained. Failed imports do not publish links or keep
partial uploads. Unlinking an imported dataset does not erase its files.

Cards receive sample/source/feature counts and target task type from the
library inspection, not from browser-provided counters. A user-selected
dataset name is preserved. Refresh rejects a configuration changed during
inspection. Linking without any configured scientific host is still an
offline catalogue operation with explicitly unknown metadata; a configured
host failure does not fall back to that operation. Refresh does not claim
content-hash verification: integrity status remains separately unchecked.

Confinement is checked before and after configuration normalization, including
all returned references. This is not an absolute anti-TOCTOU guarantee for
external, concurrently editable source files.
