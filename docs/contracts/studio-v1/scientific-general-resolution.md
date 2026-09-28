# General scientific request resolution

`ScientificRequestResolver::resolve_general` is separate from the original,
path-free portable `resolve` contract. It produces
`nirs4all.studio-scientific-job.v2` requests for the attested synchronous library
host. Rust remains the job/workspace/HTTP owner; the adapter does not schedule
work, and dataset parsing and numerical execution remain library responsibilities.

The resolver accepts saved and inline editor pipelines. It delegates them to
`pipeline.normalize` and preserves the returned canonical runtime steps, including
their ordering and nested composition. It does not impose the old PLS-only,
128-sample, 256-feature demonstration limits or invent cross-validation.

Dataset IDs must come from the saved catalogue. `dataset.configure` must return
an explicit canonical object, not an opaque folder/config path. References are
resolved beneath that dataset's catalogue root both before and after adaptation,
including metadata, folds, nested sources and partition index files. An adapter
must resolve folder auto-detection through the library normalizer before returning.
An existing saved dataset record may instead contain only
`config.dataset_document` with the exact outer shape
`{"schema":"nirs4all.studio-multimodal-dataset.v1","cohort":{...}}`.
`PUT /api/datasets/{id}` with that sole config field replaces a saved flat
config, so a previously linked record can hold the descriptor without mixed
file and inline settings. Returning that record to a flat file config currently
requires deleting and relinking it.
The 1 MiB inline descriptor is passed through `dataset.configure` and must be
returned unchanged. Rust checks the stored marker, closed outer shape, size,
and adapter equality; the scientific Python host owns reconstruction and
validation of the `MultimodalDataset.to_dict()` cohort. This path still requires
an existing catalogue record with an authorized directory. Studio does not yet
create these records in the UI, inspect their contents, or use them for prediction.
The scientific host exports a native `.n4a` into `exports/` beneath the authorized
workspace, where the existing general-model catalogue can discover it. Flat file dataset
records continue through normal path checks.
Rust reads saved pipeline/catalogue JSON through capability-rooted bounded handles.
Document payloads are limited to 2 MiB and final scientific requests to 8 MiB;
these limits do not bound the number of rows/features in the underlying dataset.

All dataset/pipeline/run identities must agree with the strict split specs and
ordered source-run manifest. The multi-run callable is Cartesian: it is used
only when every requested pair is present. A sparse/paired matrix needs separate
Rust-owned calls; it is never expanded silently. Skipped or inconsistent manifests
are rejected before execution. `engine=dag-ml` and `allow_fallback=false` remain
mandatory.

`name`, `random_state` and project ownership are forwarded; the workspace comes
only from preflight. Artifact persistence is enabled and chart generation disabled
for this transport. `test_size`, grouping, robustness and UI-level CV overrides
still require explicit library-owned translations; this resolver does not claim
to implement them or accept-and-ignore them. Their rejection is a remaining
integration limitation, not a scientific feature completion.

The V2 result may report a multimodal archive through `result.archive_path`.
This form requires empty `run_ids` and `native_results_dirs`; the other summary
fields retain their usual types. Rust accepts the archive only when it is an
existing regular `.n4a` file at a canonical path beneath the authorized
workspace from the submitted request, and `result.workspace_path` must equal
that canonical workspace. A result without `archive_path` keeps the
existing requirement for nonempty run IDs and available native score sets.

Path validation is not an OS sandbox for approved scientific Python operators.
Canonical paths passed to subsequent processes can be replaced after validation;
the packaging/host threat model must address concurrent filesystem mutation.
This resolver alone does not claim descriptor-level confinement of all later IO.

The ordinary Rust tests exercise normalization, inline ordering, complete versus
sparse matrices, path escapes, invalid adapter results and preserved portable V1
behavior. The ignored opt-in witness
`installed_library_executes_general_resolved_request` runs the real document
adapter and installed V2 callable using `STUDIO_GENERAL_TEST_PYTHON`. It verifies
Ridge CV, persisted run IDs and native score availability on 150 × 300 data,
without installing packages or enabling a source-tree runtime fallback itself.
