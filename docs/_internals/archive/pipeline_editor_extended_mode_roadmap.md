# Roadmap — Pipeline Editor Extended/Expert Mode + Full Operator Catalog

This roadmap assumes the goals and constraints described in `pipeline_editor_extended_mode_plan.md`.

## Current Status (Updated 2026-01-08)

**Milestone 3 is COMPLETE.** The generator script now produces a comprehensive extended registry with:
- **253 total nodes** (significantly improved from initial 208)
- **92 sklearn transformers** (StandardScaler, MinMaxScaler, PCA, etc.) - deduplicated by classPath
- **99 sklearn models** (regressors + classifiers)
- **15 sklearn splitters** (KFold, StratifiedKFold, etc.)
- **33 nirs4all operators** (SNV, MSC, SavitzkyGolay, SPXY, spline augmenters, etc.)
- **31 TensorFlow/Keras models** (from both generic and nicon modules)

**Coverage:**
- 100% coverage of `nirs4all/public/component-library.json` classPaths (222 classPaths covered)
- 343 total nodes available with Extended Mode (114 builtin + 229 new from extended)
- Proper deduplication: PLSRegression, CCA, etc. correctly typed as models (not preprocessing)

**Recent Fixes (2026-01-08):**
1. Fixed classPath-based deduplication to avoid duplicate entries for dual-role sklearn classes
2. Fixed TensorFlow model discovery to include both generic and nicon modules (31 models now)
3. Added missing spline augmenters: Spline_X_Simplification, Spline_Curve_Simplification
4. Added `--skip-tensorflow` flag for faster generation when TF not needed
5. Models are now generated first to ensure regressors/classifiers take precedence over transformers

Nodes are properly categorized with human-readable categories matching the webapp's UI taxonomy.

## Guiding Principles
- Keep **basic mode curated** and fast.
- Extended mode must be **lazy-loaded** to avoid bloating initial bundles.
- Prefer **deterministic generation** and stable IDs.
- Avoid a half-migration: consolidate on a **single node definition type** for editor behavior.

---

## Milestone 0 — Align Schema, Types, and Existing JSON (Blocker Removal)

### 0.1 Decide the “source of truth”
Pick one:
- **Option A (recommended)**: Update schema/types to reflect real node JSON needs.
- **Option B**: Normalize node JSON files to match the current schema.

Acceptance criteria:
- A small script (or build-time check) can validate *current* `src/data/nodes/definitions/**` without errors.

### 0.2 Resolve container schema drift
Current container JSON includes fields and `containerType` values that do not match schema enums.

Actions:
- Either:
  - expand `node.schema.json` to allow the container fields used by wrappers (and widen `containerType`), **or**
  - migrate wrappers JSON to use only schema-supported fields.

Acceptance criteria:
- Containers load into `NodeRegistry` and can be used in the editor without TS workarounds/casts.

### 0.3 Resolve `sequential` type gap
`StepType` contains `sequential`, registry `NodeType` does not.

Actions:
- Either add `sequential` to registry `NodeType` + schema, **or**
- explicitly keep `sequential` as legacy-only until later.

Acceptance criteria:
- No code path requires `as any` to represent `sequential` nodes.

---

## Milestone 1 — Extended Mode Toggle (UI) with Current Data Source

Goal: deliver user-visible value quickly while keeping risk low.

### 1.1 Add palette toggle + persistence
- Add checkbox: `Extended mode`.
- Persist to `localStorage` (or app settings if already available).

Acceptance criteria:
- Toggle persists across reload.

### 1.2 Filter behavior
- Basic: hide `isAdvanced` options.
- Extended: show all.

Implementation detail:
- First iteration can apply to legacy `stepOptions` only (fastest), then later to registry nodes.

Acceptance criteria:
- Palette content changes instantly and search continues to work.

---

## Milestone 2 — Switch Pipeline Editor to the Real Node Registry

Goal: make the editor palette, config panels, and converters rely on the `src/data/nodes` registry.

### 2.1 Replace the pipeline-editor NodeRegistryContext bridge
- Replace `src/components/pipeline-editor/contexts/NodeRegistryContext.tsx` implementation with a provider that:
  - builds a `NodeRegistry` from built-in nodes,
  - merges custom nodes (`CustomNodeStorage`),
  - exposes registry search + lookup.

Acceptance criteria:
- `StepPalette` can fetch nodes by type from registry.

### 2.2 Unify “default params” computation
- Stop relying on legacy `defaultParams` fields.
- Compute defaults from `ParameterDefinition.default` using:
  - `NodeRegistry.getDefaultParams(nodeId)` or
  - `parametersToDefaultParams(parameters)`.

Acceptance criteria:
- Adding a node from palette yields the same default behavior as before.

### 2.3 Wire Extended mode toggle to registry filtering
- Basic mode filters registry nodes with `node.isAdvanced`.
- Extended mode shows all registry nodes.

Acceptance criteria:
- Toggle affects registry-driven palette.

### 2.4 Expert parameters (optional, but recommended)
- Add a second toggle or a per-panel “Show expert parameters”.
- Hide params where `param.isExpert` unless enabled.

Acceptance criteria:
- Parameter panels are less noisy by default.

---

## Milestone 3 — Generator Script: Produce New-Format NodeDefinition[]

Goal: generate the full catalog in the *webapp’s new schema*.

### 3.1 Choose output location + loading strategy
- Output to `public/node-registry/*.json` (static assets)
- Load via `fetch()` when Extended mode is enabled.

Acceptance criteria:
- Extended nodes are not bundled into initial JS chunks.

### 3.2 Implement generator output
- Inputs:
  - sklearn estimators/transformers/splitters via Python reflection
  - nirs4all bundled operators (manual map or module scan)
- Outputs:
  - `NodeDefinition[]` JSON, sorted deterministically

Acceptance criteria:
- Generator produces stable output across runs (same versions).

### 3.3 Add validation
- Validate generated nodes against `node.schema.json`.
- Fail CI/script with actionable error messages.

Acceptance criteria:
- A single command can regenerate + validate.

---

## Milestone 4 — Extended Registry Integration (Lazy Merge)

Goal: enable “show all models” without harming baseline performance.

### 4.1 Lazy loader
- When Extended mode is enabled:
  - fetch extended JSON,
  - build `NodeRegistry` (or add nodes to existing registry),
  - refresh palette.

Acceptance criteria:
- No network request / load occurs unless toggle enabled.

### 4.2 Precedence rules
Define deterministic precedence order:
1. Curated built-ins
2. Extended generated nodes
3. Custom user/workspace nodes (or vice-versa if you want user override)

Recommendation:
- Let **custom override generated**, but **curated override everything**.

Acceptance criteria:
- Duplicate IDs behave predictably.

---

## Milestone 5 — Categorization & Discoverability

Goal: make the huge list usable.

### 5.1 Rule-based module → category mapping
- Implement a mapping table that assigns `category` (and optionally `categoryId`) based on module path.
- Include a fallback “Other”.

Acceptance criteria:
- 95%+ of generated nodes land in a sensible category.

### 5.2 Tagging + badges
- Add tags from module + estimator type.
- Visually badge generated nodes (e.g., “Generated”, “Requires sklearn/scipy”).

Acceptance criteria:
- Users can identify non-curated nodes quickly.

---

## Milestone 6 — Polish, Tooling, and Maintenance

### 6.1 Developer commands
Add a documented command such as:
- `python scripts/generate_node_registry.py --out public/node-registry --validate`

Webapp equivalents (implemented):
- `npm run generate:extended-registry` (writes `public/node-registry/extended.json` + `extended.meta.json`)
- `npm run validate:registry`
- `npm run registry:snapshot:update` (writes `scripts/registry-stats.snapshot.json`)
- `npm run registry:snapshot` (fails if counts drift)

### 6.2 Versioning
- Embed registry version and the sklearn version used for generation.

Implemented as a sidecar metadata file:
- `public/node-registry/extended.meta.json`

### 6.3 Regression tests (lightweight)
- Snapshot tests for node counts by type.
- A quick runtime check that palette search returns results.

---

## Key Risks & Mitigations
- **Schema drift**: fix in Milestone 0; otherwise generation/validation will be unreliable.
- **Too many nodes**: must lazy-load and consider “Generated” badge + search-first UX.
- **Parameter inference quality**: keep defaults minimal; add manual overrides for high-value operators.
- **Dependency mismatch** (operators not installed on backend): in UI, mark nodes whose import is likely to fail, and provide clear error messages at execution time.
