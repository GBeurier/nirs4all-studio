# Pipeline Editor — Extended/Expert Mode + Full Operator Catalog Plan

## Context
The webapp currently has two parallel systems:

- **Legacy palette** driven by `stepOptions` (fast but limited)
- **New node registry system** based on `NodeDefinition` JSON + `NodeRegistry` (schema’d, supports `classPath`, `legacyClassPaths`, `source`, advanced flags, and custom nodes)

Goal: reintroduce the “show all available sklearn/scipy/bundled operators” experience (as in the old version) **without overwhelming the default UX**, and while keeping compatibility with:
- curated node definitions,
- custom user nodes,
- nirs4all pipeline import/export.

## Goals

### UX goals
- Default experience stays curated and approachable.
- A single checkbox enables “Extended mode” to reveal the full catalog.
- Optional further control for “Expert parameters” (parameter-level) without forcing it on everyone.

### Data/engineering goals
- Generate a comprehensive operator catalog automatically (deterministic output).
- Keep build size reasonable via **lazy-loading extended registries**.
- Keep taxonomy stable and searchable.

## Non-goals (for first iteration)
- Perfect parameter metadata for every sklearn estimator.
- Runtime introspection in the browser.
- Auto-installation of missing Python packages.

## Current State (Key Findings)

### Node registry system exists
- `NodeDefinition` schema supports:
  - `isAdvanced` (node-level hide in basic),
  - `isExpert` (parameter-level),
  - `source` (currently enum: `nirs4all | sklearn | custom`),
  - `classPath` + `legacyClassPaths`.
- `NodeRegistry` provides fast lookup and legacy path resolution.

### Reality check (code vs schema vs editor)
The following mismatches must be acknowledged up-front (they affect feasibility and sequencing):

- **Pipeline editor still uses legacy `stepOptions`** for palette content. The current `NodeRegistryContext` inside the pipeline editor is a Phase-1 bridge that simply maps `stepOptions` → a local `NodeDefinition` type.
- **There are two different `NodeDefinition` shapes in the codebase today**:
   - `src/data/nodes/types.ts` (the schema-backed registry type)
   - `src/components/pipeline-editor/contexts/NodeRegistryContext.tsx` (bridge type that includes `defaultParams`)
   This increases the risk of “half-migrated” behavior unless unified.
- **Factory signature correction**: `createNodeRegistry()` (in `src/data/nodes/NodeRegistry.ts`) does *not* accept `allNodes` as an argument; it loads built-ins internally. To build a registry from a specific list (e.g., add extended nodes), use `new NodeRegistry(nodes)` or `mergeRegistries([...])`.
- **Schema drift warning**: some existing node JSON files under `src/data/nodes/definitions/**` include fields and values that do not match `src/data/nodes/schema/node.schema.json` (notably `containerType` values and extra container-specific fields). This means “schema validation at generation time” will fail until the schema is updated or the node JSON is normalized.
- **Type coverage gap**: the pipeline editor defines `StepType` including `sequential`, but the registry `NodeType` currently does not include `sequential`. If the editor palette is switched to registry nodes, `sequential` needs either (a) to be migrated into registry types, or (b) kept as a legacy-only step.

### Pipeline editor is not fully switched over
- `StepPalette` uses `stepOptions` or a skeleton registry context that still maps from `stepOptions`.

### Custom nodes already exist
- `CustomNodeStorage` supports persisted user-defined nodes with allowlist validation.

## Proposed Architecture

### Registry layers
1. **Base registry (curated)**
   - Use existing JSON nodes under `src/data/nodes/definitions/**`.

2. **Custom registry (user/workspace)**
   - Load from `CustomNodeStorage.getAll()`.
   - Merge into base with deterministic precedence.

3. **Extended registry (full catalog)**
   - Generated JSON (large) loaded lazily only when enabled.
   - Merged on top of base+custom.

Implementation note:
- Prefer building registries as `new NodeRegistry([...baseNodes, ...customNodes, ...extendedNodes])` rather than relying on `createNodeRegistry()` (which always pulls built-ins). `mergeRegistries()` is also valid, but it operates on registry instances.

### UI modes
- **Basic mode (default)**: hide nodes with `node.isAdvanced === true`.
- **Extended mode**: show all nodes (including advanced) in palette.
- Optional: **Expert params**: show parameters where `param.isExpert === true`.

## Implementation Plan

### Phase 1 — UI Toggle + Filtering
1. Add “Extended mode” checkbox to the pipeline editor palette UI.
2. Implement filtering:
   - When unchecked, hide `node.isAdvanced` nodes.
   - Keep search functional regardless of mode.
3. Persist in local storage (or app settings if already available).

Deliverable:
- Users can reveal/hide advanced nodes.

### Phase 2 — Switch Pipeline Editor to Real NodeRegistry
1. Replace the skeleton registry provider with an implementation based on `src/data/nodes`:
   - Start from the built-in definitions (`createNodeRegistry()` or direct `allNodes` import)
   - Merge custom nodes (`CustomNodeStorage.getAll()`) and compute default params from `parameters` (via `parametersToDefaultParams()` or `NodeRegistry.getDefaultParams()`)
   - Define a single shared `NodeDefinition` type for the editor (prefer the registry type) and add a small adapter only where needed.
2. Update palette to use registry nodes consistently.

Deliverable:
- Pipeline editor uses unified registry and can benefit from `classPath` resolution.

### Phase 3 — Generator Script Compatibility (New Format)
Create/upgrade generator script that outputs `NodeDefinition[]` JSON matching the schema.

Design choices:
- Write output under `public/node-registry/*.json` (webapp static assets).
- Validate JSON output against schema during generation.
- Ensure deterministic IDs and sorting.

Deliverable:
- Script produces valid registry JSON in the new format.

Prerequisite:
- Decide whether to (a) update `node.schema.json` to match current node JSON conventions, or (b) normalize existing node JSON files to match the schema. Without this, strict schema validation will be a constant footgun.

### Phase 4 — Generate Full Operator Catalog (Extended Registry)
Scope:
- sklearn estimators (regressors/classifiers)
- sklearn transformers (TransformerMixin)
- sklearn model selection splitters
- bundled nirs4all operators

SciPy:
- If we must include SciPy operators, either:
  - treat them as `source: custom`, or
  - extend schema/TS types to include `scipy`.

Recommendation:
- First iteration: keep schema unchanged and mark SciPy-derived nodes as `source: custom` (but generated by the app), or omit SciPy completely until there is a clear UI need. If you do include SciPy, also add a visual badge so users understand these may require additional dependencies.

Deliverable:
- Extended registry JSON with “all possible available models” as requested.

### Phase 5 — Category/Subcategory Strategy
Problem: module paths don’t map perfectly to UI categories.

Solution (3-layer taxonomy):

1. **Rule-based mapping** `modulePath -> subcategory`:
   - `sklearn.linear_model.*` -> Models/Linear
   - `sklearn.cross_decomposition.*` -> Models/PLS
   - `sklearn.svm.*` -> Models/SVM
   - `sklearn.ensemble.*` -> Models/Ensemble
   - `sklearn.preprocessing.*` -> Preprocessing/Scaling (or Preprocessing/Normalization depending)
   - `sklearn.decomposition.*` -> Preprocessing/Feature Ops or Preprocessing/Dimensionality (depending on current UI taxonomy)

2. **Fallback bucket**:
   - Add an `Other` subcategory to each major node type where needed.

3. **Small manual overrides table**:
   - For important operators: better labels/tags, and parameter metadata overrides.

Deliverable:
- Stable, predictable categorization without hand-curating thousands of nodes.

## Data Model Requirements for Generated Nodes
Each generated node must include:
- `id` (format: `type.snake_case`)
- `name`
- `type`
- `description`
- `parameters` array (can be empty but must exist)
- `source`

Recommended:
- `classPath`
- `legacyClassPaths` when needed
- `category` (subcategory label; consider also carrying a stable `categoryId` if you want to bind to `CategoryConfig.subcategories` reliably)
- `tags` (module-derived)
- `supportsStepGenerator` for nodes that can be wrapped in `_or_`

Enhancement:
- Add an `origin`/`generatedBy` metadata field (if you decide to allow it in schema) so the UI can differentiate curated vs generated vs custom nodes without relying solely on `source`.

## Parameter Metadata Strategy
Baseline (auto-generated):
- infer param names and defaults from `__init__` signatures
- types guessed from default values
- mark most params `isAdvanced: true`

Overrides (manual):
- add sweep/finetune metadata for a small set of commonly-used params

Enhancement:
- Use the existing curated model JSON files as “authoritative overrides” for popular operators: generated entries should merge into/around curated entries rather than duplicating them.

## Performance Strategy
- Base registry stays small and bundled.
- Extended registry is lazily loaded.
- Palette search remains fast by filtering pre-indexed nodes.

## Validation & Testing
- JSON schema validation for generated registry.
- Runtime check that palette renders + search works.
- Ensure classPath resolution works for:
  - public import paths
  - sklearn private module paths via `legacyClassPaths`.

Additional checks (recommended):
- Ensure editor `StepType` coverage is complete when switching to registry nodes (notably `sequential`).
- Confirm that converters (import/export to nirs4all pipeline JSON/YAML) can resolve `classPath` for every palette node.

## Open Questions
1. Do we want `source` to explicitly include `scipy`?
2. Where to persist “Extended mode” state (localStorage vs app settings API)?
3. Should extended nodes be visually marked (badge/tag) to avoid confusing users?
