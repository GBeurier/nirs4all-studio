# Canonical Pipeline Round-Trip in the Webapp

> Status: revised design and backlog, validated against the codebase on 2026-04-09.
>
> This document supersedes the previous draft. The previous version was directionally
> correct about converging on one canonical interchange format, but several concrete
> claims were already false in the current codebase.
>
> Scope: webapp editor + backend integration. No required changes to the `nirs4all`
> library schema. The library remains the source of truth for executable pipeline
> syntax and canonical component serialization.

---

## 1. Goal

Make pipeline interchange between `nirs4all` and the webapp reliable, lossless where
the editor can represent the construct, and passthrough-safe where it currently cannot.

Concretely:

1. A pipeline authored in Python and serialized for the library can be imported into
   the webapp without being downgraded to a broken subset.
2. A pipeline authored or edited in the webapp can be exported to a library-compatible
   JSON/YAML file and loaded by `PipelineConfigs(...)` / `nirs4all.run(...)`.
3. Unsupported-but-valid canonical constructs are not dropped. They are preserved via
   raw passthrough and exported unchanged.
4. Round-trip validation is based on library semantics, not just shallow JSON shape
   comparison.

Non-goals:

- Making every canonical construct fully editable in phase 1.
- Re-implementing library normalization rules in TypeScript.
- Treating the existing short-name "native" webapp YAML as the canonical interchange
  format.

---

## 2. Validated Current State

### 2.1 There are four pipeline formats today

| Format | Purpose | Current examples | Current owners |
|---|---|---|---|
| Library-compatible canonical JSON/YAML | Interchange with `nirs4all`; full wrapper/generator syntax | `api/presets/*.yaml`, `examples/pipeline_samples/*`, `src/utils/pipelineConverter.ts` | Python lib + frontend TS converter |
| Editor state (`PipelineStep[]`) | UI editing model | `src/components/pipeline-editor/types.ts` | frontend |
| Legacy backend step list (`{name,type,params}`) | Old backend training/preset path | `api/preset_loader.py`, `api/nirs4all_adapter.py` | backend |
| Short-name "native" format | Webapp-specific YAML/preview/runtime helper | `src/utils/nativePipelineFormat.ts`, `PipelineYAMLView.tsx` | frontend + backend helper code |

This fragmentation is the root problem. "Round-trip" is currently split across multiple
non-equivalent converters.

### 2.2 Confirmed failures

These are verified from the current repository, not inferred:

- `POST /pipelines/from-preset/{preset_id}` still routes through
  `canonical_to_legacy_steps(...)`, which only accepts bare class steps and simple
  `{"model": ...}` wrappers. Rich presets fail immediately.
- The shipped preset generated from
  [`scripts/presets_generation/presets.py`](../../scripts/presets_generation/presets.py)
  currently fails preset import with `400: unsupported keyword(s) ['_cartesian_']`.
- The frontend canonical converter is already in production use via
  [`usePipelineEditor.ts`](../../src/hooks/usePipelineEditor.ts) and
  [`PipelineEditor.tsx`](../../src/pages/PipelineEditor.tsx), so canonical absolutely
  does reach the frontend today.
- The frontend canonical converter does not currently handle all root-level canonical
  generators. `_or_` is handled; `_cartesian_`, `_zip_`, `_chain_`, `_sample_`, and
  separation-branch dicts are not robustly handled.
- Structured params are currently lossy. `PipelineStep.params` is typed as
  `Record<string, string | number | boolean>`, and canonical arrays/objects are often
  stringified during import. This breaks round-trip for values like
  `feature_range: [0.1, 0.9]`, enum payloads, nested configs, and tuple-serialized
  search spaces.
- Finetune tuple search spaces emitted by `serialize_component` are currently ambiguous
  in the frontend. Example: `('int', 1, 25)` serializes to `["int", 1, 25]`, but the
  current TS importer treats arbitrary arrays in `finetune_params.model_params` as
  categorical choices, which is wrong for presets like `pls_finetune_advanced.yaml`.
- The current backend `/pipelines/{id}/export` `yaml` and `json` outputs are not
  canonical library files. `yaml` uses a webapp-specific `{version, steps}` format, and
  `json` currently dumps the stored editor object.
- `PipelineYAMLView` renders the short-name native format, not canonical interchange.
- The current "round-trip" tests are misleading:
  - `tests/test_pipeline_roundtrip.py` simulates conversion logic instead of calling the
    real converters.
  - `examples/pipeline_samples/canonical/*` are not generator-preserving goldens because
    the export script uses `PipelineConfigs(...).steps[0]`, which expands generators and
    keeps only one configuration.

### 2.3 Incorrect assumptions in the previous draft

The previous version of this document needs these corrections:

- "`frontend never sees canonical`" is false today.
- "`sample_filter` is not part of canonical`" is false in practice. Library examples and
  webapp samples use `sample_filter` directly. The library also supports `tag` and
  `exclude` shorthands. The converter must accept all three.
- "`deserialize_component(C') == deserialize_component(C)` is the round-trip test"
  is not the right contract for full pipelines. Whole-pipeline wrappers and generators
  are handled by `PipelineConfigs`, not by raw `deserialize_component` equality.
- "`serialize_component` alone defines whole-pipeline canonical form" is incomplete.
  It canonicalizes component references and params, but pipeline-level wrappers,
  generators, and comments require pipeline-level handling.
- "`YAML comments` and `_comment` are the same thing" is false. YAML `#` comments are
  lost on parse; `_comment` is an explicit pseudo-step in authoring files.

---

## 3. Design Principles

### 3.1 Canonical interchange is the only supported file/API contract

If a user says "import/export a pipeline", that should mean the library-compatible
canonical form, not the editor JSON and not the short-name native preview format.

### 3.2 The editor model is a UI model, not a serialization format

The editor needs IDs, layout metadata, collapsed state, and local convenience fields.
Those must not leak into canonical files.

### 3.3 Unknown valid canonical must round-trip safely

The webapp must not reject or erase a valid library construct just because the editor
cannot fully edit it yet. The minimum bar is:

- import succeeds,
- the UI marks the step read-only or partially editable,
- export returns the original canonical payload unchanged.

`rawNirs4all` is the right mechanism for this.

### 3.4 Use one authoritative conversion implementation

Having separate "real" canonical converters in Python and TypeScript is how drift keeps
coming back. The authoritative canonical conversion path should live on the backend,
close to the library, with the frontend calling it for import/export surfaces.

The current TS converter is useful as an implementation reference and test corpus, but it
should not remain the product source of truth for canonical interchange.

### 3.5 Use the generated registry, not hardcoded mappings

The repo already contains generated node metadata in
[`src/data/nodes/generated/canonical-registry.json`](../../src/data/nodes/generated/canonical-registry.json).
That should become the shared class-path/name/type lookup source. Hardcoded class maps
and prefix categorization should be fallback-only.

---

## 4. Target Contract

### 4.1 Two compatibility levels

The system should distinguish:

1. `compatible canonical`
   - guaranteed loadable by the library
   - may use public class paths
   - may keep params verbatim if normalization is unavailable

2. `normalized canonical`
   - component paths normalized the same way `serialize_component(...)` would emit them
   - default-valued params stripped when normalization can be done safely
   - preferred for deterministic hashing and stable diffs

Compatibility is required. Full normalization is preferred but must not block export.

### 4.2 Round-trip contract

For canonical source files:

```text
canonical source
  -> canonical_to_editor
  -> editor_to_canonical
  -> canonical output
```

Acceptance rule:

- `PipelineConfigs(filter_comments(source)).original_template`
  and
  `PipelineConfigs(filter_comments(output)).original_template`
  must be equal after stable key ordering.

Why this contract:

- it preserves generator templates instead of comparing only one expanded configuration;
- it uses library preprocessing and serialization rules;
- it is stronger than simple step-count checks and more appropriate than raw
  `deserialize_component` on the whole pipeline.

For editor state:

```text
editor steps
  -> editor_to_canonical
  -> canonical_to_editor
  -> editor steps'
```

Acceptance rule:

- `steps` and `steps'` may differ in ephemeral editor-only fields such as regenerated IDs
  and UI defaults,
- but they must preserve semantic fields, structured params, generator configuration,
  wrapper metadata, and passthrough payloads.

---

## 5. Recommended Architecture

```text
                         shared generated registry json
                                    |
                                    v
                     +-------------------------------+
                     |   api/pipeline_canonical.py   |
                     |-------------------------------|
                     | canonical_to_editor(payload)  |
                     | editor_to_canonical(steps)    |
                     | validate_canonical(payload)   |
                     +-------------------------------+
                        ^            ^            ^
                        |            |            |
         preset import / file import |            | export / count / runtime
                        |            |            |
                        v            |            v
              backend endpoints      |      PipelineConfigs / runtime
                                     |
                                     v
                        frontend editor receives/returns
                             editor-shape `PipelineStep[]`
```

### 5.1 Backend-authoritative conversion

The backend should own:

- canonical file import,
- preset conversion,
- canonical export,
- runtime/count conversion from editor state.

The frontend should stop doing authoritative canonical import/export in-browser for
product flows. Browser-only import/export can remain only as a clearly labeled fallback,
or be removed.

### 5.2 Shared registry artifact

Move or generate the node registry JSON into a path that is available to both the
frontend bundle and the packaged Python backend. The current `src/...` location is not
an appropriate long-term runtime contract for Python.

### 5.3 Transitional status of existing converters

| Module | Keep? | Role after convergence |
|---|---|---|
| `api/preset_loader.py::canonical_to_legacy_steps` | No | delete after preset path migrates |
| `api/pipelines.py::_convert_frontend_steps_to_nirs4all` | No | replace with `editor_to_canonical` |
| `src/utils/pipelineConverter.ts` | Transitional | keep only until frontend import/export calls backend |
| `src/utils/nativePipelineFormat.ts` | Transitional | keep only for debug/legacy preview, not interchange |

---

## 6. Mapping Rules

This section is the target mapping contract. Items marked `passthrough-first` must be
preserved even before they become fully editable.

### 6.1 Component references

Supported canonical forms for executable components:

- `"module.path.Class"`
- `{"class": "module.path.Class", "params": {...}}`
- `{"function": "module.path.factory", "params": {...}, "framework": "..."}` for
  decorated model factories
- nested `{"enum": "...", "value": ...}` inside params

Import rules:

- Resolve via shared registry first.
- If registry knows the path or a legacy alias, use the registry node name/type.
- Do not require `importlib` just to classify a known operator.
- If the registry does not know the path, preserve the step via `rawNirs4all` and mark
  it read-only instead of failing import.

Export rules:

- Prefer the stored `classPath` or `functionPath`.
- If backend normalization is available, canonicalize the component path with
  `serialize_component(...)` on the resolved class/function and strip default params.
- If normalization is unavailable but the stored path is library-compatible, emit it
  unchanged and downgrade export status from `normalized` to `compatible`.

### 6.2 Structured params are first-class

This is a required model change:

- `PipelineStep.params` must become `Record<string, unknown>`.
- Editor parameter rendering must support:
  - primitive controls for primitive params,
  - a structured JSON control or read-only block for `array`, `object`, and `enum`
    values,
  - preservation without stringification even when no specialized UI exists.

Without this change, seamless round-trip is impossible.

Examples that must stop breaking:

- `feature_range: [0.1, 0.9]`
- `quantile_range: [25, 75]`
- enum params emitted as `{"enum": "...", "value": ...}`
- nested model/meta-estimator params
- deep-learning config objects

### 6.3 Model wrappers

Canonical wrapper:

```json
{
  "model": <inner>,
  "name": "...",
  "finetune_params": {...},
  "train_params": {...}
}
```

Editor requirements:

- preserve custom name,
- preserve `train_params`,
- preserve function-path models (`functionPath`, plus `framework` if provided),
- preserve finetune search space exactly.

Important correction for finetune search spaces:

- tuple-style search spaces emitted by `serialize_component` become JSON lists,
  e.g. `["int", 1, 25]`, `["log_float", 1e-4, 1.0]`, `["categorical", ["a", "b"]]`.
- These must not be interpreted as generic categorical arrays.
- The importer must detect the tuple-style sentinel in position `0`.
- Plain arrays that do not start with a known search-space token remain categorical
  choices.

### 6.4 `y_processing`

Fully editable in phase 1.

Canonical:

```json
{"y_processing": "sklearn.preprocessing._data.StandardScaler"}
```

or

```json
{"y_processing": {"class": "...", "params": {...}}}
```

### 6.5 Filters: `sample_filter`, `exclude`, and `tag`

The system must accept all of these:

- explicit wrapper: `{"sample_filter": {"filters": [...], "mode": "...", "report": ...}}`
- shorthand exclude: `{"exclude": Filter()}` or `{"exclude": [Filter(), ...], "mode": "..."}`
- shorthand tag: `{"tag": Filter()}` or `{"tag": [Filter(), ...]}`

Do not normalize these into one keyword on import. Preserve origin.

Recommended editor representation:

- one filter container UI,
- plus metadata recording the original keyword:
  - `"sample_filter"`
  - `"exclude"`
  - `"tag"`

Phase target:

- `sample_filter` fully editable first,
- `exclude` and `tag` import/export-safe in the same phase,
- explicit UI affordance for `tag` vs `exclude` can come later as long as origin is
  preserved.

### 6.6 Branches and separation branches

Two different branch families exist and must not be conflated:

1. Duplication branches
   - indexed: `{"branch": [[...], [...]]}`
   - named: `{"branch": {"a": [...], "b": [...]}}`
   - same samples flow through every branch

2. Separation branches
   - `{"branch": {"by_tag": "...", "steps": {...}}}`
   - `{"branch": {"by_metadata": "...", "steps": {...}}}`
   - `{"branch": {"by_filter": <filter>, "steps": {...}}}`
   - `{"branch": {"by_source": true, "steps": {...}}}`
   - different samples route to different branches

Duplication branches should be editable in the first functional implementation.

Separation branches should be `passthrough-first`:

- parse enough metadata to show a readable summary,
- preserve the original canonical payload in `rawNirs4all`,
- export unchanged,
- do not force them into the duplication-branch UI model.

### 6.7 Merge

Support both simple and structured merge payloads:

- `{"merge": "predictions"}`
- `{"merge": "features"}`
- `{"merge": "concat"}`
- `{"merge": {...structured config...}}`

`concat` is important for separation branches and must not be dropped from the design.

### 6.8 Augmentation and concat containers

These should be fully editable:

- `feature_augmentation`
- `sample_augmentation`
- `concat_transform`

Preserve action/config metadata exactly. Do not collapse branches/children in ways that
lose the difference between:

- direct lists,
- chained branch lists,
- `_or_` generator payloads inside augmentation wrappers.

### 6.9 Generators

Generators split into three categories. The previous draft treated them too uniformly.

#### A. Structural step generators

Use the existing branch/stage UI model:

- `_or_`
- `_cartesian_`
- `_chain_`

These are step-structure generators and fit naturally in the current editor, with one
important addition: support for explicit no-op alternatives.

#### B. Attached parameter generators

Attach to an operator/model step:

- `_range_`
- `_log_range_`
- attached `_grid_`
- attached `_zip_`
- attached `_sample_` if the library uses it in operator scope

These belong on the step as sweeps, not as independent flow nodes.

#### C. Pure scalar/root-level generators

Examples:

- `{"_grid_": {"alpha": [0.1, 1.0], "n_estimators": [50, 100]}}`
- `{"_zip_": {"a": [...], "b": [...]}}`
- `{"_sample_": {"distribution": "...", ...}}`

These do **not** fit the current `branches: PipelineStep[][]` model well. They need a
dedicated scalar-generator editor representation.

Recommendation:

- Do not implement them via synthetic placeholder steps.
- Either add a dedicated editor model for scalar generators, or import them as
  `passthrough-first` until that UI exists.

#### `null` / no-op options

`null` in generator choices is valid library syntax and must round-trip.

Examples:

- `_or_: [null, SNV(), MSC()]`
- stages inside `_cartesian_` that contain `null`

Do **not** map this to `IdentityTransformer`.

The editor needs an explicit UI-only no-op alternative representation that exports back
to `null`.

### 6.10 Comments

There are two completely different comment concepts:

1. YAML comments (`# ...`)
   - parser-level only
   - not preserved

2. `_comment` pseudo-steps inside JSON/YAML data
   - explicit authoring metadata
   - can be preserved by the editor
   - must be stripped before runtime execution and before semantic round-trip comparison

`_comment` should be treated as an editor/documentation utility, not as an executable
canonical step.

### 6.11 Unknown and future keywords

Unknown-but-valid canonical dicts must import as `rawNirs4all`.

This includes, at minimum, early-phase passthroughs such as:

- `metadata_partitioner`
- `rep_to_sources`
- `rep_to_pp`
- source-specific branch/merge variants that do not map cleanly to the current editor
- any new library keyword introduced before the editor grows dedicated UI

---

## 7. Product Surface Changes

### 7.1 Presets

`/pipelines/from-preset/{preset_id}` must stop using `canonical_to_legacy_steps`.

Target behavior:

- load preset canonical payload,
- convert canonical -> editor steps via the new backend converter,
- persist the editor steps,
- keep raw passthrough blocks for constructs that are not yet editable.

Acceptance example:

- `pls_finetune_advanced.yaml` imports successfully without 400 and preserves its
  `_cartesian_` stage generator plus finetune tuple search space.

### 7.2 File import

The current frontend JSON-only import is insufficient and the YAML message
"requires backend API" is already telling us the right direction.

Add backend-owned canonical import:

- JSON upload/body
- YAML upload/body
- returns editor steps or creates a persisted pipeline directly

### 7.3 File export

Fix the semantics of export.

Recommended target:

- canonical JSON/YAML export becomes the default meaning of "export pipeline"
- if editor-state JSON export is still needed, expose it explicitly as `editor_json`
- `PipelineYAMLView` should render canonical YAML, not the short-name native preview

### 7.4 Runtime and variant counting

Execution and counting should use:

```python
editor steps -> editor_to_canonical -> PipelineConfigs / runtime path
```

This removes the need for the legacy downgrade and most of the ad hoc short-name native
translation.

---

## 8. Test Strategy

The current tests are not sufficient. Replace the simulated tests with real contract
tests.

### 8.1 Golden fixtures

Use these as source fixtures:

- `api/presets/*.yaml`
- `nirs4all/examples/pipeline_samples/*`
- targeted examples from:
  - `examples/reference/R01_pipeline_syntax.py`
  - `examples/reference/R02_generator_reference.py`
  - `examples/developer/01_advanced_pipelines/D06_separation_branches.py`

Do **not** use `examples/pipeline_samples/canonical/*` as generator-preserving goldens.
Those files are generated from expanded `PipelineConfigs.steps[0]`.

### 8.2 Required tests

1. Canonical -> editor -> canonical round-trip
   - compare `PipelineConfigs(...).original_template`
   - strip `_comment` before comparison

2. Editor -> canonical -> editor round-trip
   - compare semantic editor fields after `migrateStep`

3. Runtime compatibility
   - `PipelineConfigs(exported_pipeline)` must construct successfully
   - `count_combinations(...)` must match before and after round-trip

4. Structured param preservation
   - arrays stay arrays
   - objects stay objects
   - tuple-style finetune spaces stay tuple-style search spaces

5. Passthrough preservation
   - separation branches
   - unknown keyword fixtures
   - optional-dependency models not installed locally

6. API integration
   - preset import
   - YAML file import
   - canonical export

### 8.3 Minimum red tests to add first

These should fail before implementation starts:

- importing `pls_finetune_advanced.yaml` via preset API
- importing/exporting `01_basic_regression.yaml` without stringifying `feature_range`
- importing `09_filters_splits.yaml` while preserving explicit `sample_filter`
- importing a `by_tag` separation branch example without crashing
- importing `08_complex_finetune.json` while preserving `function` model and finetune
  tuple/list distinctions

---

## 9. Phased Backlog

## Phase 0: Establish the real contract

Deliverables:

- Replace simulated round-trip tests with real converter tests.
- Add golden fixtures and failure fixtures.
- Introduce helper utilities for semantic comparison based on
  `PipelineConfigs(...).original_template`.

Acceptance:

- Red tests exist for the known failures listed above.

## Phase 1: Harden the editor data model

Deliverables:

- Change `PipelineStep.params` to `Record<string, unknown>`.
- Add structured param preservation and a JSON/object fallback editor.
- Add editor metadata for:
  - filter origin keyword (`sample_filter` / `exclude` / `tag`)
  - branch mode (`duplication` vs separation)
  - comment/no-op option support
- Keep `rawNirs4all` as the fallback escape hatch.

Acceptance:

- arrays and objects round-trip without stringification,
- `_comment` and generator no-op options can be represented without leaking fake
  executable steps.

## Phase 2: Build backend-authoritative canonical conversion

Deliverables:

- Add `api/pipeline_canonical.py`.
- Load a shared generated registry JSON instead of relying on hardcoded maps.
- Implement:
  - operators
  - model wrappers
  - `y_processing`
  - duplication branches
  - merge
  - `sample_filter` / `exclude` / `tag`
  - `feature_augmentation`
  - `sample_augmentation`
  - `concat_transform`
  - `_or_`, `_cartesian_`, `_chain_`
  - attached `_range_`, `_log_range_`, `_grid_`
  - `_comment`
- Separation branches and other unsupported shapes import/export as passthrough.

Acceptance:

- preset `pls_finetune_advanced.yaml` imports successfully,
- `PipelineConfigs(roundtrip).original_template` matches for the covered fixtures.

## Phase 3: Move product flows onto the backend converter

Deliverables:

- `from-preset` uses `canonical_to_editor`.
- file import uses backend canonical import for JSON and YAML.
- export uses `editor_to_canonical`.
- `PipelineYAMLView` renders canonical YAML.
- APIs that currently return canonical only for the frontend TS converter can return
  editor steps directly, or continue returning canonical through the backend converter.

Acceptance:

- no user-facing import/export path depends on the TS canonical converter as the source
  of truth,
- `/pipelines/{id}/export` returns real canonical JSON/YAML for those formats.

## Phase 4: Converge runtime and counting

Deliverables:

- `count` path uses `editor_to_canonical`.
- execution/build path uses canonical output instead of legacy downgrade.
- deprecate and remove `canonical_to_legacy_steps`.
- deprecate and remove `_convert_frontend_steps_to_nirs4all`.

Acceptance:

- variant counts match library `count_combinations(...)`,
- existing training flows still run,
- legacy-only preset tests are removed or rewritten to target canonical behavior.

## Phase 5: Expand editability beyond passthrough

Deliverables:

- editable separation branches,
- dedicated UI model for pure scalar generators (`_grid_`, `_zip_`, `_sample_`) if still
  needed,
- explicit UI affordances for `tag` vs `exclude`,
- richer handling for multi-source / repetition transforms.

Acceptance:

- passthrough coverage shrinks release over release without breaking export safety.

---

## 10. Recommended Decisions

These decisions remove ambiguity and should be considered part of the backlog:

1. Canonical import/export authority belongs on the backend, not in the browser.
2. The generated node registry JSON becomes the shared lookup contract.
3. Structured params are a prerequisite, not a nice-to-have.
4. `sample_filter`, `exclude`, and `tag` are all valid inputs and must preserve origin.
5. Separation branches are passthrough-first.
6. `_comment` is preserved for authoring but excluded from runtime semantics.
7. `PipelineConfigs(...).original_template` is the semantic comparison basis for
   round-trip testing.

---

## 11. Open Questions

1. Do we want browser-only canonical import/export as an explicit offline fallback once
   backend-authoritative conversion exists, or should it be removed entirely?

   No It's for adding presets also


2. Should the current `/pipelines/{id}/export` route keep its name and change semantics,
   or should canonical export get a new route to avoid ambiguity with existing editor JSON
   downloads?

   I don't understand the whole canonical and legacy stuff. Just have pipelines in the webapp that I can open from json and yaml compatible with the lib.

3. Do we want explicit editor nodes for separation branches in phase 5, or is a strong
   read-only summary card sufficient for the long term?

They already exist basically. No ?

4. Where should the shared generated registry JSON live so both the frontend bundle and
   packaged backend can depend on it safely?

I want presets, import and export. It can be anywhere, I don't care.



These do not block phase 0 through phase 3.
