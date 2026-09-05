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
