# Pipeline Editor Node Specifications

**Author:** Technical Specifications
**Date:** January 2026
**Status:** Draft v1.0
**Related:** `pipeline_editor_analysis.md`, `component_refactoring_specs.md`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Node Definition Schema](#2-node-definition-schema)
3. [Category Organization](#3-category-organization)
4. [Parameter Specification](#4-parameter-specification)
5. [Validation Rules](#5-validation-rules)
6. [Custom Node Registration](#6-custom-node-registration)
7. [File Organization](#7-file-organization)

---

## 1. Overview

### 1.1 Purpose

This specification defines the structure, organization, and validation of pipeline editor nodes (operators). The goal is to:

1. **Externalize node definitions** from component code into declarative JSON/TypeScript files
2. **Enable easy customization** by users and administrators
3. **Ensure consistency** across the application
4. **Facilitate synchronization** with nirs4all library operators
5. **Support validation** at design-time and runtime

### 1.2 Current State Analysis

Currently, node definitions are embedded in `src/components/pipeline-editor/types.ts` in the `stepOptions` object.

**What Works Well:**
- Structured object organized by `StepType` categories
- Each node has `name`, `description`, `defaultParams`, `category`, `tags`
- Type-safe within TypeScript compilation

**Key Limitations:**

| Issue | Impact |
|-------|--------|
| Embedded in TypeScript file | Non-developers cannot easily edit or extend |
| No runtime schema validation | Definition errors only caught when UI breaks |
| No custom node support | Users cannot add their own operators |
| No external synchronization | Manual effort to track nirs4all library changes |
| No i18n support | Labels/descriptions not localizable |
| Coupled to UI components | Cannot reuse in other contexts (API, CLI) |

### 1.3 Goals

1. **Separation of Concerns**: Node definitions live in dedicated JSON files
2. **Schema-First Design**: JSON Schema validates node definitions at build time
3. **Extensibility**: Support for custom/user-defined nodes
4. **Type Safety**: TypeScript types generated from schemas
5. **Maintainability**: Easy to add, modify, or deprecate nodes
6. **nirs4all Synchronization**: Clear, versioned mapping to library operators

### 1.4 Synchronization Strategy

Synchronization between webapp node definitions and nirs4all library operators uses a **hybrid approach**:

1. **nirs4all manifest**: The library publishes a `nodes.json` manifest with each release listing all operators, their parameters, and class paths
2. **Webapp import**: At build time, the webapp imports and validates against this manifest
3. **UI enrichment**: The webapp maintains UI-specific metadata (colors, icons, sweep presets) as an overlay
4. **Version tracking**: Each node definition includes `minVersion` and `maxVersion` for compatibility

```typescript
interface SyncConfig {
  nirs4allVersion: string;           // Current synced version
  lastSyncDate: string;              // ISO date of last sync
  manifestUrl?: string;              // URL to fetch manifest (CI/CD)
  overrideFile?: string;             // Local UI enrichment file
}
```

---

## 2. Node Definition Schema

### 2.1 Schema Design Philosophy

The schema uses a **layered approach** to keep simple nodes simple while supporting complex ones:

| Layer | Fields | Usage |
|-------|--------|-------|
| **Required** | id, name, type, classPath, description, parameters, source | All nodes |
| **Common** | category, tags, aliases, isAdvanced | Most nodes |
| **Behavioral** | validAfter, validBefore, requiresSplitter, maxInstances | Constrained nodes |
| **Generator** | supportsParameterSweeps, supportsFinetuning | Model & preprocessing nodes |
| **Container** | isContainer, containerType, defaultBranches | Branch, augmentation nodes |
| **Lifecycle** | isDeprecated, deprecationMessage, version, legacyClassPaths | Versioned nodes |

A minimal preprocessing node needs only ~10 fields; a complex container node may use 25+.

### 2.2 Core Node Schema

Each node is defined by a `NodeDefinition` object:

```typescript
interface NodeDefinition {
  // === Identity ===
  id: string;                    // Unique identifier: "preprocessing.snv"
  name: string;                  // Display name: "SNV"
  type: NodeType;                // Category: "preprocessing", "model", etc.

  // === nirs4all Mapping ===
  classPath: string;             // Full import path: "nirs4all.operators.transforms.StandardNormalVariate"
  aliases?: string[];            // Alternative names: ["StandardNormalVariate", "standard_normal_variate"]
  functionPath?: string;         // For function-based operators: "nirs4all.operators.models.tensorflow.nicon.customizable_nicon"

  // === Display ===
  description: string;           // Short description for tooltips
  longDescription?: string;      // Extended documentation
  category?: string;             // Subcategory: "NIRS Core", "Baseline", etc.
  icon?: string;                 // Optional icon override
  color?: string;                // Optional color override
  tags?: string[];               // Searchable tags: ["scatter", "normalization"]

  // === Parameters ===
  parameters: ParameterDefinition[];

  // === Behavior ===
  isAdvanced?: boolean;          // Hide in basic mode
  isDeepLearning?: boolean;      // Show training config tab
  isExperimental?: boolean;      // Show warning badge
  isDeprecated?: boolean;        // Show deprecation notice
  deprecationMessage?: string;   // Migration guidance

  // === Constraints ===
  validAfter?: string[];         // Can only appear after these types
  validBefore?: string[];        // Can only appear before these types
  requiresSplitter?: boolean;    // Must have a splitter before this node
  maxInstances?: number;         // Max occurrences in pipeline

  // === Generator Support ===
  supportsParameterSweeps?: boolean;   // Can use _range_, _or_, etc.
  supportsFinetuning?: boolean;        // Can use finetune_params (models only)
  supportsStepGenerator?: boolean;     // Can be wrapped in _or_ at step level

  // === Container Behavior ===
  isContainer?: boolean;         // Has children (sample_augmentation, branch, etc.)
  containerType?: "branches" | "children";  // How children are organized
  defaultBranches?: number;      // Initial branch count for container nodes

  // === Versioning & Migration ===
  source: "nirs4all" | "sklearn" | "custom";
  version?: string;              // Minimum nirs4all version required
  maxVersion?: string;           // Maximum supported version (for deprecated)
  legacyClassPaths?: string[];   // Previous class paths for backwards compatibility
}
```

### 2.2 Parameter Definition Schema

Parameters are defined with full metadata for UI rendering and validation:

```typescript
interface ParameterDefinition {
  // === Identity ===
  name: string;                  // Parameter name: "n_components"
  label?: string;                // Display label (defaults to humanized name)

  // === Type ===
  type: ParameterType;           // "int" | "float" | "bool" | "string" | "select" | "array" | "object"

  // === Constraints ===
  required?: boolean;            // Is this parameter required?
  default?: unknown;             // Default value
  min?: number;                  // Minimum value (numeric types)
  max?: number;                  // Maximum value (numeric types)
  step?: number;                 // Step size for numeric inputs
  minLength?: number;            // Min length (string/array)
  maxLength?: number;            // Max length (string/array)
  pattern?: string;              // Regex pattern (strings)

  // === Select Options ===
  options?: SelectOption[];      // For type="select"
  allowCustom?: boolean;         // Allow values not in options

  // === Display ===
  description?: string;          // Tooltip/help text
  placeholder?: string;          // Input placeholder
  unit?: string;                 // Display unit: "ms", "%", etc.
  group?: string;                // Group related params: "Advanced", "Training"
  order?: number;                // Display order within group

  // === Behavior ===
  isAdvanced?: boolean;          // Hide in basic view
  isExpert?: boolean;            // Require expert mode to edit
  isHidden?: boolean;            // Never show in UI (internal use)

  // === Validation ===
  validator?: string;            // Custom validator function name
  dependsOn?: string;            // Only show if this param has specific value
  dependsOnValue?: unknown;      // Value that enables this param
  conditionalDefault?: {         // Default varies based on other params
    param: string;
    mapping: Record<string, unknown>;
  };

  // === Generator Support ===
  sweepable?: boolean;           // Can this param have a sweep attached?
  sweepPresets?: SweepPreset[];  // Quick presets for this param
  finetunable?: boolean;         // Can this param be finetuned with Optuna?
  finetuneType?: "int" | "float" | "log_float" | "categorical";
  finetuneRange?: [number, number];  // Default finetune range
}

interface SelectOption {
  value: string | number | boolean;
  label: string;
  description?: string;
}

interface SweepPreset {
  label: string;
  type: "range" | "log_range" | "choices";
  values: unknown;  // Depends on type
}
```

### 2.3 Example Node Definition

```json
{
  "id": "preprocessing.savitzky_golay",
  "name": "SavitzkyGolay",
  "type": "preprocessing",
  "classPath": "nirs4all.operators.transforms.SavitzkyGolay",
  "description": "Savitzky-Golay smoothing and derivative filter",
  "longDescription": "Applies a Savitzky-Golay filter for smoothing or computing derivatives while preserving spectral features. Window length must be odd.",
  "category": "Derivatives",
  "tags": ["smoothing", "derivative", "filter", "polynomial"],
  "source": "nirs4all",
  "parameters": [
    {
      "name": "window_length",
      "type": "int",
      "default": 11,
      "min": 3,
      "max": 101,
      "step": 2,
      "description": "Size of the moving window (must be odd)",
      "sweepable": true,
      "sweepPresets": [
        { "label": "Small (5-15)", "type": "range", "values": { "from": 5, "to": 15, "step": 2 } },
        { "label": "Medium (11-31)", "type": "range", "values": { "from": 11, "to": 31, "step": 4 } }
      ],
      "finetunable": true,
      "finetuneType": "int",
      "finetuneRange": [5, 51]
    },
    {
      "name": "polyorder",
      "type": "int",
      "default": 2,
      "min": 0,
      "max": 6,
      "description": "Polynomial order for fitting (must be less than window_length)",
      "sweepable": true,
      "finetunable": true,
      "finetuneRange": [1, 5]
    },
    {
      "name": "deriv",
      "type": "select",
      "default": 0,
      "options": [
        { "value": 0, "label": "Smoothing only", "description": "No derivative" },
        { "value": 1, "label": "First derivative", "description": "Rate of change" },
        { "value": 2, "label": "Second derivative", "description": "Curvature" }
      ],
      "description": "Derivative order (0=smoothing, 1=first, 2=second)",
      "sweepable": true
    }
  ],
  "supportsParameterSweeps": true,
  "supportsStepGenerator": true
}
```

### 2.4 Class Path Resolution and Validation

The `classPath` field maps UI nodes to nirs4all operators. This is validated at multiple levels:

**Build-Time Validation:**
```typescript
// Validate against nirs4all manifest
const manifest = await loadNirs4allManifest();
for (const node of nodeDefinitions) {
  const found = manifest.operators.find(op =>
    op.classPath === node.classPath ||
    node.aliases?.includes(op.classPath) ||
    node.legacyClassPaths?.includes(op.classPath)
  );
  if (!found) {
    warnings.push(`Node ${node.id}: classPath not found in manifest`);
  }
}
```

**Runtime Graceful Degradation:**
```typescript
// If classPath fails, show warning but don't break
try {
  const operator = await resolveOperator(node.classPath);
} catch (e) {
  console.warn(`Operator ${node.classPath} not available`);
  return { ...node, unavailable: true, unavailableReason: e.message };
}
```

**Migration Support:**
When nirs4all renames a class:
1. Add old path to `legacyClassPaths` array
2. Update `classPath` to new location
3. Existing pipelines using old path still work via alias resolution

---

## 3. Category Organization

### 3.1 Category Hierarchy

Nodes are organized in a two-level hierarchy:

```
NodeType (Primary Category)
└── category (Subcategory)
    └── Individual Nodes
```

### 3.2 Standard Categories

| NodeType | Label | Description |
|----------|-------|-------------|
| `preprocessing` | Preprocessing | Feature transformation and scaling |
| `y_processing` | Target Processing | Target variable scaling/discretization |
| `splitting` | Splitting | Train/test splitting and cross-validation |
| `model` | Models | Regression and classification models |
| `generator` | Generators | Step-level generators (_or_, cartesian) |
| `branch` | Branching | Parallel pipeline paths |
| `merge` | Merge | Combine branch outputs |
| `filter` | Filters | Sample filtering and outlier removal |
| `augmentation` | Augmentation | Training-time data augmentation operators |
| `sample_augmentation` | Sample Augmentation | Container for sample augmentation |
| `feature_augmentation` | Feature Augmentation | Container for feature-level augmentation |
| `sample_filter` | Sample Filter | Container for composite filters |
| `concat_transform` | Concat Transform | Horizontal feature concatenation |
| `chart` | Charts | Visualization steps |
| `comment` | Comments | Documentation/annotation steps |

### 3.3 Subcategory Configuration

Subcategories are defined per NodeType:

```typescript
interface CategoryConfig {
  type: NodeType;
  label: string;
  description: string;
  icon: string;
  color: ColorScheme;
  subcategories: SubcategoryConfig[];
  defaultOpen?: boolean;         // Expanded by default in palette
  displayOrder: number;          // Order in palette
}

interface SubcategoryConfig {
  id: string;
  label: string;
  description?: string;
  displayOrder: number;
}
```

### 3.4 Example Category File

```json
{
  "type": "preprocessing",
  "label": "Preprocessing",
  "description": "Transform and prepare spectral data",
  "icon": "Waves",
  "color": {
    "border": "border-blue-500/30",
    "bg": "bg-blue-500/5",
    "text": "text-blue-500"
  },
  "defaultOpen": true,
  "displayOrder": 1,
  "subcategories": [
    { "id": "nirs_core", "label": "NIRS Core", "displayOrder": 1 },
    { "id": "derivatives", "label": "Derivatives", "displayOrder": 2 },
    { "id": "smoothing", "label": "Smoothing", "displayOrder": 3 },
    { "id": "baseline", "label": "Baseline", "displayOrder": 4 },
    { "id": "wavelet", "label": "Wavelet", "displayOrder": 5 },
    { "id": "conversion", "label": "Conversion", "displayOrder": 6 },
    { "id": "feature_selection", "label": "Feature Selection", "displayOrder": 7 },
    { "id": "feature_ops", "label": "Feature Ops", "displayOrder": 8 },
    { "id": "scaling", "label": "Scaling", "displayOrder": 9 }
  ]
}
```

---

## 4. Parameter Specification

### 4.1 Parameter Types

| Type | TypeScript | UI Component | Validation |
|------|------------|--------------|------------|
| `int` | `number` | NumberInput with step | Integer, min/max |
| `float` | `number` | NumberInput with decimals | Number, min/max |
| `bool` | `boolean` | Switch | Boolean |
| `string` | `string` | Input | String, pattern, length |
| `select` | `string \| number \| boolean` | Select dropdown | Value in options |
| `array` | `unknown[]` | MultiInput or TagInput | Min/max length, item type |
| `object` | `Record<string, unknown>` | Nested form or JSON editor | Schema validation |

### 4.2 Parameter Groups

Parameters can be organized into logical groups:

```typescript
const parameterGroups = {
  core: { label: "Core Parameters", order: 1, collapsible: false },
  advanced: { label: "Advanced", order: 2, collapsible: true, defaultCollapsed: true },
  training: { label: "Training", order: 3, collapsible: true },
  expert: { label: "Expert", order: 4, collapsible: true, requiresExpertMode: true }
};
```

### 4.3 Parameter Dependencies

Parameters can have conditional visibility based on other parameters:

**Simple Conditions:**
```typescript
{
  name: "custom_value",
  dependsOn: "mode",
  dependsOnValue: "custom"  // Only show when mode === "custom"
}
```

**Complex Conditions (Extended):**
For compound logic, use `dependsOnExpression`:
```typescript
{
  name: "advanced_option",
  dependsOnExpression: {
    "and": [
      { "==": [{ "var": "mode" }, "advanced"] },
      { ">": [{ "var": "depth" }, 3] }
    ]
  }
}
```

The expression format follows [JSON Logic](https://jsonlogic.com/) for portability.

**Note:** Start with simple `dependsOn` for most cases. Only use `dependsOnExpression` when truly needed.

### 4.4 Sweepable Parameters

Parameters marked as `sweepable: true` can have generators attached:

```typescript
interface SweepableParameter extends ParameterDefinition {
  sweepable: true;
  sweepPresets?: SweepPreset[];
  defaultSweepType?: "range" | "log_range" | "choices";
}
```

**Sweep Presets** are quick-fill templates that populate the sweep configuration UI:
- User sees: "Quick presets: Small (5-15), Medium (11-31), Custom..."
- Selecting a preset fills the form but doesn't lock values
- User can modify after selecting a preset

### 4.4 Finetunable Parameters

Parameters marked as `finetunable: true` can be optimized with Optuna:

```typescript
interface FinetunableParameter extends ParameterDefinition {
  finetunable: true;
  finetuneType: "int" | "float" | "log_float" | "categorical";
  finetuneRange?: [number, number];
  finetuneStep?: number;  // For int type
  finetuneChoices?: unknown[];  // For categorical
}
```

---

## 5. Validation Rules

### 5.1 Validation Timing

Different validation levels run at different times:

| Level | When | Behavior |
|-------|------|----------|
| **Schema validation** | Build time only | Fail build if node definitions are invalid |
| **Parameter validation** | Debounced on change (500ms) | Show inline errors next to fields |
| **Pipeline validation** | On "Validate" action or before export | Full pipeline analysis with detailed report |
| **Real-time hints** | Always visible | Lightweight checks: "no model yet", "consider adding splitter" |

### 5.2 Schema Validation

Node definitions are validated against JSON Schema at build time:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["id", "name", "type", "classPath", "description", "parameters", "source"],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^[a-z]+\\.[a-z_]+$"
    },
    "name": {
      "type": "string",
      "minLength": 1
    },
    "type": {
      "enum": ["preprocessing", "y_processing", "splitting", "model", "generator", "branch", "merge", "filter", "augmentation", "sample_augmentation", "feature_augmentation", "sample_filter", "concat_transform", "chart", "comment"]
    }
  }
}
```

### 5.2 Parameter Validation Rules

| Rule | Description | When Checked |
|------|-------------|--------------|
| Required | Parameter must have a value | Runtime |
| Type | Value must match declared type | Runtime |
| Range | Numeric value within min/max | Runtime |
| Pattern | String matches regex | Runtime |
| Options | Select value in options list | Runtime |
| Custom | Custom validator function | Runtime |
| Cross-parameter | Value depends on other params | Runtime |

### 5.4 Pipeline-Level Validation

| Rule | Severity | Description |
|------|----------|-------------|
| Order constraints | Error | `validAfter`/`validBefore` must be respected |
| Model required | Error | Pipeline must have at least one model |
| Splitter recommendation | **Warning** | If no splitter, warn: "No splitter defined; LeaveOneOut will be used by default" |
| Max instances | Error | Node not exceeding `maxInstances` |
| Container contents | Error | Container nodes have valid children |
| Circular references | Error | No circular branch references |
| Deprecated nodes | Warning | Using deprecated node shows migration guidance |
| Unavailable operators | Warning | classPath not found in current nirs4all version |

**Note:** "Splitter before model" is a recommendation, not a requirement. nirs4all defaults to LeaveOneOut when no splitter is specified.

### 5.5 Validation Implementation

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  nodeId?: string;
  paramName?: string;
  code: string;
  message: string;
  path: string[];  // Path in pipeline tree
}

interface ValidationWarning {
  nodeId?: string;
  code: string;
  message: string;
  suggestion?: string;
}
```

---

## 6. Custom Node Registration

### 6.1 Namespace and Conflict Resolution

Custom nodes use namespaced IDs to prevent conflicts:

| Namespace | Format | Priority | Example |
|-----------|--------|----------|---------|
| Built-in | `{type}.{name}` | Highest | `preprocessing.snv` |
| Admin | `admin.{name}` | High | `admin.company_preprocessor` |
| Workspace | `workspace.{name}` | Medium | `workspace.project_transform` |
| User | `user.{name}` or `custom.{name}` | Lowest | `user.my_filter` |

**Conflict Rules:**
- IDs must be unique within their namespace
- Built-in nodes cannot be overridden (safety)
- To customize a built-in, create a new custom node with different ID
- Admin can explicitly allow overrides via configuration flag

### 6.2 Security Considerations

Custom nodes introduce security risks. Mitigations:

| Risk | Mitigation |
|------|------------|
| Malicious classPath | Validate against installed packages allowlist |
| Arbitrary code execution | classPath must resolve to installed operator |
| Resource exhaustion | Timeout limits on custom node execution |
| Data exfiltration | Network access restrictions (future sandbox) |

**Admin Controls:**
```typescript
interface SecurityConfig {
  allowCustomNodes: boolean;           // Master switch
  allowedPackages: string[];           // e.g., ["nirs4all", "sklearn", "my_package"]
  requireApproval: boolean;            // Admin must approve custom nodes
  sandboxMode: "none" | "basic" | "strict";  // Future: execution sandboxing
}
```

### 6.3 Custom Node Sources

### 6.3 Custom Node Sources

Custom nodes can come from three sources:

1. **User-defined**: Loaded from `~/.nirs4all/custom_nodes.json`
2. **Workspace-defined**: Part of project at `.nirs4all/nodes.json`
3. **Admin-defined**: System-wide at `/etc/nirs4all/nodes.json` or admin console

### 6.4 Registration API

```typescript
// Node Registry API
interface NodeRegistry {
  // Core operations
  register(definition: NodeDefinition): void;
  unregister(nodeId: string): void;
  get(nodeId: string): NodeDefinition | undefined;
  getAll(): NodeDefinition[];

  // Filtering
  getByType(type: NodeType): NodeDefinition[];
  getByCategory(type: NodeType, category: string): NodeDefinition[];
  search(query: string): NodeDefinition[];

  // Validation
  validate(definition: NodeDefinition): ValidationResult;

  // Custom nodes
  registerCustom(definition: NodeDefinition): void;
  getCustomNodes(): NodeDefinition[];
  clearCustomNodes(): void;

  // Persistence
  saveCustomNodes(): void;
  loadCustomNodes(): void;
}
```

### 6.5 Custom Node File Format

Custom nodes are stored in `~/.nirs4all/custom_nodes.json` or workspace-local `.nirs4all/nodes.json`:

```json
{
  "version": "1.0",
  "nodes": [
    {
      "id": "custom.my_preprocessor",
      "name": "MyCustomPreprocessor",
      "type": "preprocessing",
      "classPath": "my_package.transforms.MyCustomPreprocessor",
      "description": "My custom preprocessing step",
      "category": "Custom",
      "source": "custom",
      "parameters": [
        {
          "name": "strength",
          "type": "float",
          "default": 0.5,
          "min": 0,
          "max": 1
        }
      ]
    }
  ]
}
```

### 6.6 Custom Node UI

The palette shows a "Custom" section for user-defined nodes:

```
┌─ Components ────────────────────────────┐
│                                         │
│ ▼ Preprocessing (38)                    │
│ ▼ Splitting (16)                        │
│ ▼ Models (30)                           │
│ ...                                     │
│                                         │
│ ───────────────────────────────────────│
│ ▼ Custom (2)                            │
│   • MyCustomPreprocessor               │
│   • MyCustomModel                      │
│                                         │
│ [+ Add Custom Node]                     │
└─────────────────────────────────────────┘
```

---

## 7. File Organization

### 7.1 Location Decision

Node definitions are placed in `src/data/nodes/` for pragmatic reasons:

| Option | Pros | Cons |
|--------|------|------|
| `src/data/nodes/` ✓ | Bundled with app, type-safe imports | Mixed with source |
| `public/nodes/` | External loading possible | Runtime fetch required, no type safety |
| Separate npm package | Independent versioning | Extra build complexity |

**Current choice:** `src/data/nodes/` with structure supporting future extraction to npm package.

### 7.2 Directory Structure

```
src/
├── data/
│   └── nodes/
│       ├── index.ts                    # Node registry and exports
│       ├── schema/
│       │   ├── node.schema.json        # JSON Schema for nodes
│       │   └── parameter.schema.json   # JSON Schema for parameters
│       ├── categories/
│       │   ├── index.ts                # Category registry
│       │   ├── preprocessing.json      # Preprocessing category config
│       │   ├── splitting.json
│       │   ├── models.json
│       │   └── ...
│       ├── definitions/
│       │   ├── preprocessing/
│       │   │   ├── index.ts            # Re-exports all preprocessing nodes
│       │   │   ├── nirs-core.json      # SNV, MSC, EMSC, etc.
│       │   │   ├── derivatives.json    # SavitzkyGolay, FirstDerivative, etc.
│       │   │   ├── baseline.json       # ASLS, AirPLS, etc.
│       │   │   ├── smoothing.json      # Gaussian, MovingAverage, etc.
│       │   │   ├── scaling.json        # StandardScaler, MinMaxScaler, etc.
│       │   │   └── ...
│       │   ├── splitting/
│       │   │   ├── index.ts
│       │   │   ├── nirs-splitters.json
│       │   │   └── sklearn-splitters.json
│       │   ├── models/
│       │   │   ├── index.ts
│       │   │   ├── pls-variants.json
│       │   │   ├── linear.json
│       │   │   ├── ensemble.json
│       │   │   ├── deep-learning.json
│       │   │   └── meta.json
│       │   └── ...
│       ├── validation/
│       │   ├── index.ts                # Validation exports
│       │   ├── schema-validator.ts     # JSON Schema validation
│       │   ├── pipeline-validator.ts   # Pipeline-level validation
│       │   └── rules/                  # Custom validation rules
│       └── helpers/
│           ├── class-path-resolver.ts  # Resolve class paths
│           ├── parameter-helpers.ts    # Parameter utilities
│           └── sweep-helpers.ts        # Sweep preset utilities
```

### 7.3 Build-Time Processing

Node definitions are processed at build time:

1. **Validate**: Check all JSON files against schema
2. **Merge**: Combine all node definitions into single registry
3. **Generate Types**: Create TypeScript types from definitions
4. **Optimize**: Tree-shake unused definitions for production

### 7.4 Runtime Loading

```typescript
// src/data/nodes/index.ts
import { NodeRegistry, createNodeRegistry } from './registry';

// Import all node definitions
import preprocessingNodes from './definitions/preprocessing';
import splittingNodes from './definitions/splitting';
import modelNodes from './definitions/models';
// ... etc

// Create and populate registry
const registry = createNodeRegistry();

// Register built-in nodes
[...preprocessingNodes, ...splittingNodes, ...modelNodes].forEach(node => {
  registry.register(node);
});

// Load custom nodes from localStorage/file
registry.loadCustomNodes();

export { registry };
export type { NodeDefinition, ParameterDefinition } from './types';
```

---

## 8. Migration Plan

### 8.1 Phase 1: Extract Current Definitions

**Goal:** Convert `stepOptions` from `types.ts` to JSON format.

**Steps:**
1. Write extraction script to parse `stepOptions` object
2. Convert each node to `NodeDefinition` JSON
3. Handle non-serializable values:
   - Functions → Replace with string identifiers + runtime resolution
   - Class references → Convert to classPath strings
   - Complex defaults → Use factory pattern markers
4. Validate against JSON Schema
5. Generate initial node files organized by category

**Non-Serializable Handling:**
```typescript
// Before (in types.ts)
defaultParams: {
  transformer: StandardScaler,  // Class reference
  callback: (x) => x * 2        // Function
}

// After (in JSON)
"parameters": [
  { "name": "transformer", "type": "class", "default": "sklearn.preprocessing.StandardScaler" },
  { "name": "callback", "type": "factory", "factoryId": "multiply_by_2" }
]

// Runtime resolution
const factories = {
  "multiply_by_2": (x) => x * 2
};
```

### 8.2 Phase 2: Implement Registry

**Goal:** Create `NodeRegistry` class and integrate with existing code.

**Steps:**
1. Create `NodeRegistry` class with full API
2. Implement loading from JSON files
3. Add TypeScript type generation from schema
4. Replace `stepOptions` references with registry calls
5. Update `StepPalette` to use registry
6. Update `pipelineConverter` to use registry for class resolution

### 8.3 Phase 3: Add Validation

**Goal:** Implement multi-level validation system.

**Steps:**
1. Add JSON Schema validation to build process
2. Implement runtime parameter validation with debouncing
3. Create pipeline-level validator with severity levels
4. Integrate validation errors with editor UI
5. Add validation status indicator to pipeline toolbar

### 8.4 Phase 4: Custom Node Support

**Goal:** Enable users to add their own operators.

**Steps:**
1. Implement custom node storage (localStorage + file API)
2. Create "Add Custom Node" wizard UI
3. Add namespace validation and conflict detection
4. Implement security validation (allowlist checking)
5. Document custom node creation in user guide

### 8.5 Migration Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Extract | 2-3 days | None |
| Phase 2: Registry | 3-4 days | Phase 1 |
| Phase 3: Validation | 2-3 days | Phase 2 |
| Phase 4: Custom Nodes | 3-4 days | Phase 3 |

**Total estimated:** 10-14 days

---

## Appendix A: Complete Node Type Reference

See `definitions/` directory for complete node definitions.

## Appendix B: JSON Schema Files

See `schema/` directory for JSON Schema definitions.
