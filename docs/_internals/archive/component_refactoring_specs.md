# Pipeline Editor Component Refactoring Specifications

**Author:** Technical Specifications
**Date:** January 2026
**Status:** Draft v1.0
**Related:** `node_specifications.md`, `implementation_roadmap.md`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Current Component Analysis](#2-current-component-analysis)
3. [Identified Issues](#3-identified-issues)
4. [Proposed Architecture](#4-proposed-architecture)
5. [Component Decomposition](#5-component-decomposition)
6. [Shared Patterns Library](#6-shared-patterns-library)
7. [State Management Refactoring](#7-state-management-refactoring)
8. [Testing Strategy](#8-testing-strategy)

---

## 1. Overview

### 1.1 Purpose

This specification documents the current state of Pipeline Editor components and proposes a refactoring plan to improve:

1. **Maintainability**: Reduce file sizes, extract reusable patterns
2. **Extensibility**: Make it easier to add new step types and features
3. **Testability**: Enable unit testing of isolated components
4. **Performance**: Optimize re-renders and lazy load heavy components
5. **Developer Experience**: Clear patterns, consistent naming, good documentation

### 1.2 Current Inventory

The `src/components/pipeline-editor/` directory contains **24 files**:

| Category | Files | Total Lines |
|----------|-------|-------------|
| Core Display | PipelineCanvas, PipelineTree, PipelineNode, TreeNode | 1,994 |
| Configuration | StepConfigPanel, StepContextMenu, StepPalette | 3,506 |
| Generators | SweepConfigPopover, OrGenerator, CartesianGenerator | 1,896 |
| Finetuning | FinetuneConfig | 1,568 |
| Specialized Panels | YProcessingPanel, FeatureAugmentationPanel, StackingPanel | 2,256 |
| Branch Management | BranchEnhancements | 605 |
| Preview/Execution | ExecutionPreviewPanel, PipelineExecutionDialog | 1,046 |
| Navigation/UX | CommandPalette, KeyboardShortcutsDialog, FocusIndicator, HelpSystem | 1,650 |
| Infrastructure | PipelineDndContext, types.ts, index.ts | ~1,200 |
| **Total** | **24 files** | **~15,344 lines** |

### 1.3 Refactoring Goals

| Goal | Metric | Target |
|------|--------|--------|
| Reduce largest file | StepConfigPanel.tsx | < 500 lines |
| Improve code reuse | Duplicated patterns | < 10% duplication |
| Enable testing | Component test coverage | > 60% |
| Optimize loading | Lazy-loaded components | Heavy panels lazy |

---

## 2. Current Component Analysis

### 2.1 Complexity Metrics

Lines of code is one metric, but we also consider:

| Metric | Description | Threshold |
|--------|-------------|-----------|
| Lines of Code | Raw size | > 500 lines = review |
| Responsibilities | Distinct concerns | > 3 = split |
| Import Count | Dependencies | > 30 = review |
| Change Frequency | Git churn | High churn = stabilize |

**StepConfigPanel Analysis:**
- LOC: 2,561 (🔴 high)
- Responsibilities: 13+ step type handlers (🔴 high)
- Imports: 50+ (🔴 high)
- Change Frequency: Modified in 80% of pipeline-editor PRs (🔴 high)

### 2.2 Component Size Distribution

```
Lines  | Component                    | Concern
-------|------------------------------|------------------------------------------
2,561  | StepConfigPanel.tsx          | 🔴 CRITICAL - All step type configs
1,568  | FinetuneConfig.tsx           | 🟠 HIGH - Finetuning UI
  907  | TreeNode.tsx                 | 🟠 HIGH - Recursive tree rendering
  830  | FeatureAugmentationPanel.tsx | 🟡 MEDIUM - Feature augmentation config
  762  | StackingPanel.tsx            | 🟡 MEDIUM - Stacking/merge config
  668  | SweepConfigPopover.tsx       | 🟡 MEDIUM - Sweep configuration
  664  | YProcessingPanel.tsx         | 🟡 MEDIUM - Y-processing config
  659  | OrGenerator.tsx              | 🟡 MEDIUM - OR generator UI
  640  | CommandPalette.tsx           | 🟡 MEDIUM - Command palette
  612  | HelpSystem.tsx               | 🟡 MEDIUM - Contextual help
  605  | BranchEnhancements.tsx       | 🟡 MEDIUM - Branch UI components
  590  | PipelineNode.tsx             | 🟡 MEDIUM - Node display
< 600  | (12 other files)             | 🟢 OK - Appropriately sized
```

### 2.2 StepConfigPanel Deep Dive (Critical File)

The 2,561-line `StepConfigPanel.tsx` is the largest file and handles:

1. **Step type detection** - Mapping step.type to appropriate UI
2. **Parameter rendering** - Generic parameter form fields
3. **Type-specific content** - Custom UIs for each step type:
   - ModelStepContent (~400 lines)
   - YProcessingStepContent (~200 lines)
   - MergeStepContent (~300 lines)
   - BranchStepContent (~150 lines)
   - GeneratorStepContent (~250 lines)
   - FilterStepContent (~150 lines)
   - AugmentationStepContent (~200 lines)
   - SampleAugmentationStepContent (~150 lines)
   - FeatureAugmentationStepContent (~100 lines)
   - SampleFilterStepContent (~100 lines)
   - ConcatTransformStepContent (~100 lines)
   - ChartStepContent (~150 lines)
   - CommentStepContent (~50 lines)
4. **Sweep/Finetune tabs** - Advanced configuration tabs
5. **Action buttons** - Delete, duplicate, reset

### 2.3 Component Coupling Analysis

```
                    ┌─────────────────────┐
                    │   types.ts          │
                    │   (stepOptions,     │
                    │    PipelineStep)    │
                    └──────────┬──────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
            ▼                  ▼                  ▼
    ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
    │ StepPalette   │  │ StepConfig    │  │ PipelineNode  │
    │ (reads from)  │  │ Panel (uses)  │  │ (displays)    │
    └───────┬───────┘  └───────┬───────┘  └───────────────┘
            │                  │
            │          ┌───────┴───────┐
            │          │ Specialized   │
            │          │ Panels        │
            ▼          ▼               ▼
    ┌───────────────────────────────────────┐
    │ usePipelineEditor hook               │
    │ (state management)                   │
    └───────────────────────────────────────┘
```

**Key Dependencies:**
- `types.ts` is imported by 18+ components
- `StepConfigPanel` imports 8 specialized panel components
- All components depend on `usePipelineEditor` hook for state

---

## 3. Identified Issues

### 3.1 Monolithic Components

**Issue:** `StepConfigPanel.tsx` contains 13+ step type renderers in one file.

**Impact:**
- Hard to find and modify specific step type logic
- Large bundle size even for simple step types
- Difficult to test individual step renderers
- Merge conflicts when multiple developers work on different step types

### 3.2 Duplicated Patterns

**Issue:** Similar UI patterns repeated across components.

**Examples:**
| Pattern | Occurrences | Lines Each |
|---------|-------------|------------|
| Collapsible section with header | 15+ | ~40 lines |
| Parameter input with label/tooltip | 50+ | ~25 lines |
| Badge with count indicator | 12+ | ~15 lines |
| Switch with description | 20+ | ~20 lines |
| Select with dynamic options | 30+ | ~35 lines |

**Impact:**
- Inconsistent styling across similar elements
- Changes require updates in multiple places
- Larger bundle size

### 3.3 Prop Drilling vs Context Trade-offs

**Issue:** Deep prop drilling for callbacks and state.

**Example Path:**
```
PipelineEditor → PipelineCanvas → PipelineNode → BranchesContainer
    → TreeNode → NestedStepDisplay → (same step again for nested)
```

**Props drilled:** `onRemoveStep`, `onDuplicateStep`, `onMoveStep`, `onSelectStep`, `selectedStepId`, `onAddBranch`, `onRemoveBranch`

**Trade-off Analysis:**

| Approach | Pros | Cons |
|----------|------|------|
| Props | Explicit dependencies, easy to trace | Verbose, easy to miss, repetitive |
| Context | Clean component signatures | Hidden dependencies, potential over-rendering |

**Recommendation:** Use **both strategically**:
- **Context for:** Global state mutations (`removeStep`, `selectStep`, etc.)
- **Props for:** Component-specific data (the step being rendered, branch index)

This eliminates 80% of prop drilling while keeping component contracts explicit for local data.

### 3.4 Missing Lazy Loading

**Issue:** All components loaded upfront, even heavy panels.

**Heavy Components:**
- `FinetuneConfig` (1,568 lines) - Only used for model steps
- `StackingPanel` (762 lines) - Only used for merge steps
- `FeatureAugmentationPanel` (830 lines) - Only for feature_augmentation steps

**Impact:**
- Slower initial load
- Larger JS bundle

**UX Considerations for Lazy Loading:**

| Risk | Mitigation |
|------|------------|
| Visible loading spinners | Use skeleton placeholders matching component shape |
| Jarring content shift | Preload on hover/focus intent |
| Critical path delays | Only lazy-load rarely-used panels |

**Lazy Loading Candidates:**
- ✅ `StackingPanel` - Only merge steps, rarely used
- ✅ `FeatureAugmentationPanel` - Specialized, rarely used
- ⚠️ `FinetuneConfig` - Common for models, consider preloading
- ❌ `StepConfigPanel` - Critical path, never lazy

### 3.5 Tight Coupling to stepOptions

**Issue:** Components directly import and iterate over `stepOptions`.

**Problematic Patterns:**
```typescript
// In StepPalette.tsx
Object.entries(stepOptions).filter(...)

// In StepConfigPanel.tsx
const optionData = stepOptions[step.type]?.[step.name];
```

**Impact:**
- Cannot easily swap node definition source
- Breaks when transitioning to NodeRegistry
- Hard to mock for testing

---

## 4. Proposed Architecture

### 4.1 Directory Organization Principles

Before proposing structure, establish principles:

1. **Minimum 3 files** - Only create subdirectory if 3+ related files
2. **Mental model alignment** - Names match how developers think about the system
3. **Flat imports** - index.ts provides clean public API regardless of internal structure
4. **Colocation** - Related tests, types, and utilities near components

### 4.2 New Directory Structure

```
src/components/pipeline-editor/
├── index.ts                         # Public exports
├── types.ts                         # Shared types (refactored)
│
├── core/                            # Core display components
│   ├── PipelineCanvas.tsx
│   ├── PipelineNode.tsx
│   ├── PipelineTree.tsx
│   └── TreeNode.tsx
│
├── config/                          # Configuration panels
│   ├── StepConfigPanel.tsx          # Thin orchestrator (< 300 lines)
│   ├── ParameterForm.tsx            # Generic parameter rendering
│   └── step-renderers/              # Per-step-type renderers
│       ├── index.ts                 # Dynamic import registry
│       ├── ModelRenderer.tsx
│       ├── PreprocessingRenderer.tsx
│       ├── SplittingRenderer.tsx
│       ├── BranchRenderer.tsx
│       ├── MergeRenderer.tsx
│       ├── GeneratorRenderer.tsx
│       ├── FilterRenderer.tsx
│       ├── AugmentationRenderers.tsx
│       ├── ChartRenderer.tsx
│       └── CommentRenderer.tsx
│
├── generators/                      # Generator components
│   ├── SweepConfig/
│   │   ├── SweepConfigPopover.tsx
│   │   ├── SweepRangeForm.tsx
│   │   ├── SweepChoicesForm.tsx
│   │   └── SweepPresets.tsx
│   ├── OrGenerator.tsx
│   └── CartesianGenerator.tsx
│
├── finetuning/                      # Finetuning components
│   ├── FinetuneTab.tsx
│   ├── FinetuneParamList.tsx
│   ├── FinetuneParamEditor.tsx
│   └── FinetuneSearchConfig.tsx
│
├── specialized/                     # Heavy specialized panels
│   ├── YProcessingPanel.tsx
│   ├── FeatureAugmentationPanel.tsx
│   ├── StackingPanel.tsx
│   └── BranchEnhancements.tsx
│
├── ux/                              # UX enhancement components
│   ├── CommandPalette.tsx
│   ├── KeyboardShortcutsDialog.tsx
│   ├── FocusIndicator.tsx
│   ├── HelpSystem.tsx
│   └── StepContextMenu.tsx
│
├── execution/                       # Execution-related
│   ├── ExecutionPreviewPanel.tsx
│   └── PipelineExecutionDialog.tsx
│
├── palette/                         # Step palette
│   ├── StepPalette.tsx
│   ├── CategorySection.tsx
│   └── DraggableStep.tsx
│
├── dnd/                             # Drag-and-drop (keep if grows)
│   └── PipelineDndContext.tsx       # May stay in root if only 1-2 files
│
└── shared/                          # Shared UI patterns
    ├── CollapsibleSection.tsx
    ├── ParameterInput.tsx
    ├── ParameterSelect.tsx
    ├── ParameterSwitch.tsx
    ├── CountBadge.tsx
    ├── InfoTooltip.tsx
    └── ValidationMessage.tsx
```

### 4.2 Component Responsibility Matrix

| Component | Single Responsibility |
|-----------|----------------------|
| `StepConfigPanel` | Orchestrate which renderer to show based on step type |
| `ParameterForm` | Render a list of parameters from definition |
| `ModelRenderer` | Render model-specific UI (training config, finetune) |
| `SweepConfigPopover` | Configure a single parameter's sweep |
| `ParameterInput` | Render one input with label, help, validation |

### 4.3 Dependency Inversion

Instead of importing `stepOptions` directly, components receive node definitions via:

1. **Context Provider** (preferred for global access)
2. **Props** (for explicit dependencies)
3. **Hook** (for computed/derived data)

```typescript
// NEW: Use hook abstraction
const { getNodeDefinition, getParameterDefinitions } = useNodeRegistry();
const nodeDef = getNodeDefinition(step.type, step.name);

// INSTEAD OF: Direct import
import { stepOptions } from './types';
const optionData = stepOptions[step.type]?.[step.name];
```

---

## 5. Component Decomposition

### 5.1 StepConfigPanel Decomposition

**Current:** 2,561 lines, 13+ step type handlers inline

**Proposed:**

```typescript
// StepConfigPanel.tsx (~250 lines)
export function StepConfigPanel({ step, onUpdate, onRemove, onDuplicate }) {
  const StepRenderer = useStepRenderer(step.type);

  return (
    <Panel>
      <PanelHeader step={step} onRemove={onRemove} onDuplicate={onDuplicate} />
      <Tabs>
        <TabsContent value="config">
          <Suspense fallback={<RendererSkeleton />}>
            <StepRenderer step={step} onUpdate={onUpdate} />
          </Suspense>
        </TabsContent>
        <TabsContent value="sweep">
          <SweepTab step={step} onUpdate={onUpdate} />
        </TabsContent>
        {step.type === 'model' && (
          <TabsContent value="finetune">
            <FinetuneTab step={step} onUpdate={onUpdate} />
          </TabsContent>
        )}
      </Tabs>
    </Panel>
  );
}
```

```typescript
// config/step-renderers/index.ts
const renderers: Record<StepType, React.LazyExoticComponent<...>> = {
  preprocessing: lazy(() => import('./PreprocessingRenderer')),
  model: lazy(() => import('./ModelRenderer')),
  splitting: lazy(() => import('./SplittingRenderer')),
  // ...
};

export function useStepRenderer(type: StepType) {
  return renderers[type] ?? renderers.default;
}
```

### 5.2 TreeNode Decomposition

**Current:** 907 lines with recursive rendering, drag-drop, context menus

**Proposed:**

```
TreeNode.tsx (~300 lines)
├── NodeHeader.tsx (~100 lines)      # Step icon, name, badges
├── NodeActions.tsx (~80 lines)      # Quick action buttons
├── NestedContent.tsx (~150 lines)   # Branch/container children
└── NodeDragHandle.tsx (~50 lines)   # Drag handle component
```

### 5.3 FinetuneConfig Decomposition

**Current:** 1,568 lines with all finetuning components

**Already Well-Structured:** The file exports multiple components but they're in one file.

**Proposed:**
```
finetuning/
├── FinetuneTab.tsx (~200 lines)
├── FinetuneParamList.tsx (~300 lines)
├── FinetuneParamEditor.tsx (~400 lines)
├── FinetuneSearchConfig.tsx (~200 lines)
├── FinetunePresets.tsx (~150 lines)
├── types.ts (~50 lines)
└── index.ts
```

---

## 6. Shared Patterns Library

### 6.1 CollapsibleSection

Extracted pattern for collapsible UI sections:

```typescript
// shared/CollapsibleSection.tsx
interface CollapsibleSectionProps {
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  badge,
  defaultOpen = false,
  children
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-muted/50 rounded-lg">
        <span className="font-medium text-sm">{title}</span>
        <div className="flex items-center gap-2">
          {badge}
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 py-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
```

### 6.2 ParameterInput

Unified parameter input with label, description, and sweep support:

```typescript
// shared/ParameterInput.tsx
interface ParameterInputProps {
  definition: ParameterDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  sweep?: ParameterSweep;
  onSweepChange?: (sweep: ParameterSweep | null) => void;
  disabled?: boolean;
  error?: string;
}

export function ParameterInput({
  definition,
  value,
  onChange,
  sweep,
  onSweepChange,
  disabled,
  error
}: ParameterInputProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          {definition.label ?? humanize(definition.name)}
          {definition.description && (
            <InfoTooltip content={definition.description} />
          )}
        </Label>
        {definition.sweepable && onSweepChange && (
          <SweepActivator
            sweep={sweep}
            onSweepChange={onSweepChange}
            definition={definition}
          />
        )}
      </div>

      <InputRenderer
        type={definition.type}
        value={value}
        onChange={onChange}
        options={definition.options}
        min={definition.min}
        max={definition.max}
        step={definition.step}
        disabled={disabled || !!sweep}
      />

      {error && <ValidationMessage type="error">{error}</ValidationMessage>}
      {sweep && <SweepBadge sweep={sweep} />}
    </div>
  );
}
```

### 6.3 Pattern Catalog

| Pattern | Component | Usage |
|---------|-----------|-------|
| Collapsible section | `CollapsibleSection` | Grouping related controls |
| Parameter input | `ParameterInput` | All parameter fields |
| Select dropdown | `ParameterSelect` | Enum/choice parameters |
| Toggle switch | `ParameterSwitch` | Boolean parameters |
| Info tooltip | `InfoTooltip` | Help text display |
| Count badge | `CountBadge` | Items count (branches, sweeps) |
| Validation message | `ValidationMessage` | Error/warning display |
| Action button row | `ActionButtonRow` | Delete, duplicate, etc. |
| Empty state | `EmptyState` | No items placeholder |
| Loading skeleton | `Skeleton` | Lazy load fallback |

---

## 7. State Management Refactoring

### 7.1 Migration Strategy

To avoid having two parallel state systems during migration:

1. **Context wraps existing hook** (Adapter pattern)
2. **Components migrate incrementally** - One component at a time switches to context
3. **Hook remains as implementation** - Context delegates to hook internally
4. **No "big bang" switch** - Gradual, reversible migration

```typescript
// contexts/PipelineContext.tsx - Initially wraps existing hook
export function PipelineProvider({ children }) {
  const hookValue = usePipelineEditor();  // Existing hook

  // Context exposes same interface, backed by hook
  return (
    <PipelineContext.Provider value={hookValue}>
      {children}
    </PipelineContext.Provider>
  );
}
```

### 7.2 Current State

State managed by `usePipelineEditor` hook in `src/hooks/usePipelineEditor.ts`:

- Pipeline steps array
- Selected step ID
- History for undo/redo
- Persistence to localStorage

### 7.3 Proposed Context Structure

**Design Choice:** Single unified context vs multiple split contexts

| Approach | Pros | Cons |
|----------|------|------|
| Single context | Simpler to use, fewer providers | May cause over-rendering |
| Split contexts | Better performance isolation | More boilerplate, complex setup |

**Recommendation:** Start with single context. Split only if profiling reveals rendering bottlenecks.

```typescript
// contexts/PipelineContext.tsx
interface PipelineContextValue {
  // Pipeline data
  steps: PipelineStep[];
  metadata: PipelineMetadata;

  // Selection
  selectedStepId: string | null;
  selectStep: (id: string | null) => void;

  // Mutations
  addStep: (step: StepDefinition, path?: string[], index?: number) => void;
  updateStep: (id: string, updates: Partial<PipelineStep>) => void;
  removeStep: (id: string, path?: string[]) => void;
  moveStep: (id: string, direction: 'up' | 'down', path?: string[]) => void;
  duplicateStep: (id: string, path?: string[]) => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Import/Export
  importPipeline: (source: string | File) => Promise<void>;
  exportPipeline: (format: 'json' | 'yaml' | 'python') => string;
}
```

### 7.4 NodeRegistryContext

Separate context for node definitions (read-only, rarely changes):

```typescript
// contexts/NodeRegistryContext.tsx
interface NodeRegistryContextValue {
  getNodeDefinition: (type: StepType, name: string) => NodeDefinition | undefined;
  getAllNodes: () => NodeDefinition[];
  getNodesByType: (type: StepType) => NodeDefinition[];
  searchNodes: (query: string) => NodeDefinition[];

  // Custom nodes
  registerCustomNode: (definition: NodeDefinition) => void;
  getCustomNodes: () => NodeDefinition[];
}
```

### 7.5 Local Component State

Keep local to components:
- Collapse/expand state
- Search/filter text
- Tab selection
- Form validation errors

Use `useState` or `useReducer` locally, not in global context.

### 7.6 Prop Drilling Elimination

Replace deep prop drilling with context consumption:

```typescript
// BEFORE
<PipelineCanvas
  steps={steps}
  selectedStepId={selectedStepId}
  onSelectStep={selectStep}
  onRemoveStep={removeStep}
  onDuplicateStep={duplicateStep}
  onMoveStep={moveStep}
  onAddBranch={addBranch}
  onRemoveBranch={removeBranch}
>
  <PipelineNode {...allThesePropsAgain}>
    <TreeNode {...andAgain}>
      ...
    </TreeNode>
  </PipelineNode>
</PipelineCanvas>

// AFTER
<PipelineProvider>
  <PipelineCanvas>
    <PipelineNode>
      <TreeNode />  {/* Uses usePipelineContext() internally */}
    </PipelineNode>
  </PipelineCanvas>
</PipelineProvider>
```

---

## 8. Testing Strategy

### 8.1 Test Infrastructure

> **Note:** Verify project test framework before implementation. Examples assume Vitest; adapt syntax if Jest is used.

### 8.2 Test Categories

| Category | Scope | Tools |
|----------|-------|-------|
| Unit | Shared components, utilities | Vitest/Jest, React Testing Library |
| Integration | Step renderers, panels | Vitest/Jest, MSW for mocking |
| Visual | Component appearance | Storybook, Chromatic |
| E2E | Full pipeline workflows | Playwright |

### 8.3 Testable Boundaries

After refactoring, these become testable units:

```typescript
// shared/ParameterInput.test.tsx
describe('ParameterInput', () => {
  it('renders number input for int type', () => { ... });
  it('shows validation error', () => { ... });
  it('disables input when sweep active', () => { ... });
});

// config/step-renderers/ModelRenderer.test.tsx
describe('ModelRenderer', () => {
  it('shows training config tab for deep learning models', () => { ... });
  it('shows finetune badge when finetune configured', () => { ... });
});
```

### 8.4 Mocking Strategy

```typescript
// test-utils/mocks.ts
export const mockNodeRegistry: NodeRegistryContextValue = {
  getNodeDefinition: vi.fn((type, name) => mockNodes[`${type}.${name}`]),
  getAllNodes: vi.fn(() => Object.values(mockNodes)),
  // ...
};

// Usage in tests
render(
  <NodeRegistryContext.Provider value={mockNodeRegistry}>
    <ComponentUnderTest />
  </NodeRegistryContext.Provider>
);
```

### 8.5 Coverage Goals

Coverage targets reflect risk and complexity:

| Area | Target | Rationale |
|------|--------|-----------|
| Shared components | 90% | Reused everywhere; bugs multiply |
| Step renderers | 70% | Business logic heavy |
| Specialized panels | 50% | Less critical, UI-heavy |
| Core display | 60% | Moderate complexity |
| Integration | 40% | Slower to write/run |

**Note:** These are starting targets. Adjust based on actual defect rates discovered during development.

---

## 9. Migration Approach

### 9.1 Incremental Migration

Refactor in phases to minimize disruption:

**Phase 1: Extract Shared Patterns (Low Risk)**
1. Create `shared/` directory
2. Extract one pattern at a time
3. Replace usages incrementally
4. No behavior changes

**Phase 2: Add Context Providers (Medium Risk)**
1. Create `PipelineContext` alongside existing hook
2. Wrap existing components with provider
3. Gradually migrate components to use context
4. Remove prop drilling

**Phase 3: Split Step Renderers (Medium Risk)**
1. Create `step-renderers/` directory
2. Extract one step type at a time
3. Wire up lazy loading
4. Update StepConfigPanel to use renderers

**Phase 4: Reorganize Directory (Low Risk)**
1. Move files to new locations
2. Update imports
3. Update `index.ts` exports
4. Ensure no breaking changes to public API

### 9.2 Backwards Compatibility

During migration, maintain backwards compatibility:

```typescript
// index.ts - Keep all existing exports working
export { StepConfigPanel } from './config/StepConfigPanel';  // New location
export { PipelineCanvas } from './core/PipelineCanvas';      // New location

// Re-export everything that was previously exported
export * from './types';
```

---

## Appendix A: Component Audit Checklist

For each component being refactored:

- [ ] Identify single responsibility
- [ ] Extract duplicated patterns
- [ ] Remove direct `stepOptions` imports
- [ ] Add TypeScript strict types
- [ ] Add JSDoc comments
- [ ] Create unit tests
- [ ] Update index.ts exports
- [ ] Update documentation

## Appendix B: Estimated Effort

| Task | Effort | Priority |
|------|--------|----------|
| Extract shared patterns | 3 days | P1 |
| Create context providers | 2 days | P1 |
| Split StepConfigPanel | 4 days | P1 |
| Split TreeNode | 2 days | P2 |
| Split FinetuneConfig | 2 days | P2 |
| Add lazy loading | 1 day | P2 |
| Reorganize directories | 2 days | P3 |
| Add unit tests | 5 days | P3 |
| Update documentation | 2 days | P3 |

**Total estimated: 23 days**
