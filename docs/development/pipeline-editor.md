# Pipeline editor

The pipeline editor lets users assemble nirs4all workflows visually. It is one
of the highest-risk areas in the app because it bridges UI state, validation,
operator registries, and backend execution.

## Main concepts

| Concept | Meaning |
| --- | --- |
| Step | A configured operator instance in the pipeline. |
| Node definition | Registry entry describing an available operator, parameters, category, and UI metadata. |
| Palette | Searchable list of node definitions users can add. |
| Config panel | Step-specific controls for parameters and advanced settings. |
| Validation result | Errors and warnings produced from step, parameter, and pipeline rules. |
| Dataset binding | Optional dataset context used for target and shape-aware validation. |

## Source layout

| Path | Purpose |
| --- | --- |
| `src/components/pipeline-editor/PipelineCanvas.tsx` | Main editor canvas. |
| `src/components/pipeline-editor/StepPalette.tsx` | Operator palette. |
| `src/components/pipeline-editor/StepConfigPanel.tsx` | Selected step configuration. |
| `src/components/pipeline-editor/PipelineExecutionDialog.tsx` | Run launch and execution setup. |
| `src/components/pipeline-editor/contexts/` | Editor state providers. |
| `src/components/pipeline-editor/shared/` | Parameter input controls and shared UI. |
| `src/components/pipeline-editor/validation/` | Validation engine, rules, hooks, and UI. |
| `src/data/nodes/` | Registry definitions and schema. |

## Node registry layers

The editor reads operators from multiple sources:

| Layer | Source | Use |
| --- | --- | --- |
| Static registry | `src/data/nodes/definitions/` | Curated built-in nodes with stable UI metadata. |
| Extended registry | `public/node-registry/extended.json` | Generated catalog discovered from sklearn, nirs4all, TensorFlow, and related packages. |
| Custom nodes | `src/data/nodes/custom/` and workspace settings | User, workspace, or admin-defined operators. |

Static definitions are validated by `npm run validate:nodes`. Extended registry
drift is checked by `npm run registry:snapshot`.

## Node definition change flow

1. Find the closest existing definition under `src/data/nodes/definitions/`.
2. Add or update the node JSON.
3. Confirm the parameter schema is explicit.
4. Update labels, descriptions, defaults, min/max, and options.
5. Run:

```bash
npm run validate:nodes
npm run test -- src/data/nodes
```

6. If generated registry output changed intentionally, run:

```bash
npm run registry:snapshot:update
```

## Validation layers

| Layer | Checks |
| --- | --- |
| Parameter | required values, types, min/max, enum values. |
| Step | structure, compatible node type, configured container behavior. |
| Pipeline | model presence, splitter/model ordering, branch structure, generator expansion. |
| Shape | input/output compatibility when dataset context is available. |

Validation should explain what to fix. Avoid errors that only restate an
internal invariant.

## Backend handoff

The UI pipeline is not executed directly. It is serialized and sent to the
backend, where `api/nirs4all_adapter.py` converts the Studio structure into
nirs4all pipeline configuration.

When changing serialization:

- update TypeScript types
- update adapter parsing
- update backend validation or tests
- keep old import behavior only when there is a real compatibility need
- document migration behavior if exported pipeline JSON changes

## Search spaces

The editor supports OR, range, and Cartesian generators. These can multiply run
counts quickly. Keep count and preview routes fast, and make variant counts
visible before execution.

## Custom nodes

Custom nodes should follow the same validation expectations as built-in nodes.
See [Custom Nodes](custom-nodes.md) for storage, allowlist, and import/export
behavior.
