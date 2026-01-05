# Pipeline Editor Implementation Roadmap

**Author:** Technical Specifications
**Date:** January 2026
**Status:** Draft v1.0
**Related:** `node_specifications.md`, `component_refactoring_specs.md`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Implementation Phases](#2-implementation-phases)
3. [Phase 1: Foundation](#3-phase-1-foundation)
4. [Phase 2: Node Registry](#4-phase-2-node-registry)
5. [Phase 3: Component Refactoring](#5-phase-3-component-refactoring)
6. [Phase 4: Validation System](#6-phase-4-validation-system)
7. [Phase 5: Custom Nodes](#7-phase-5-custom-nodes)
8. [Phase 6: Testing & Documentation](#8-phase-6-testing--documentation)
9. [Risk Management](#9-risk-management)
10. [Success Metrics](#10-success-metrics)

---

## 1. Executive Summary

### 1.1 Scope

This roadmap covers the implementation of:
- **Node Specification System**: Externalized, schema-validated node definitions
- **Component Refactoring**: Modular, testable component architecture
- **Validation System**: Multi-level validation with clear error reporting
- **Custom Node Support**: User and admin-defined operators

### 1.2 Timeline Overview

| Phase | Description | Duration | Start | Dependencies |
|-------|-------------|----------|-------|--------------|
| 1 | Foundation | 1 week | Week 1 | None |
| 2 | Node Registry | 2 weeks | Week 2 | Phase 1 |
| 3 | Component Refactoring | 3 weeks | Week 4 | Phase 2 |
| 4 | Validation System | 1.5 weeks | Week 7 | Phase 2, 3 |
| 5 | Custom Nodes | 2 weeks | Week 8.5 | Phase 4 |
| 6 | Testing & Docs | 2 weeks | Week 10.5 | All |

**Total Duration:** ~12 weeks (3 months)

**⚠️ Contingency:** Add 20% buffer for real-world factors (code review, meetings, unexpected issues) = **~14 weeks realistic**

**Incremental Delivery:** Each phase produces deployable output. Partial completion of later phases still provides value.

### 1.3 Resource Requirements

| Role | Allocation | Notes |
|------|------------|-------|
| Frontend Developer | 1.0 FTE | Primary implementation |
| Designer | 0.25 FTE | Custom node UI, error states |
| Tech Lead | 0.25 FTE | Architecture review, blockers |
| QA Engineer | 0.5 FTE | Test strategy, E2E tests |

### 1.4 Key Deliverables

1. `src/data/nodes/` - Node definition system
2. Refactored `pipeline-editor/` components
3. `NodeRegistry` API and context
4. Pipeline validation system
5. Custom node registration UI
6. 60%+ test coverage on core components
7. Updated developer documentation

---

## 2. Implementation Phases

### 2.1 Phase Dependency Graph

```
┌──────────────┐
│   Phase 1    │
│  Foundation  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Phase 2    │
│ Node Registry│
└──────┬───────┘
       │
   ┌───┴───┐
   │       │
   ▼       ▼
┌──────┐  ┌──────┐
│ Ph 3 │  │ Ph 4 │  (can run in parallel after Phase 2)
│Refact│  │Valid │
└──┬───┘  └──┬───┘
   │         │
   └────┬────┘
        ▼
┌──────────────┐
│   Phase 5    │
│ Custom Nodes │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Phase 6    │
│ Testing/Docs │
└──────────────┘
```

### 2.2 Incremental Delivery

Each phase produces working, deployable software:

| Phase | Deployable Output |
|-------|-------------------|
| 1 | Shared components library (internal) |
| 2 | Node registry with JSON definitions (feature-flagged) |
| 3 | Refactored StepConfigPanel (gradual migration) |
| 4 | Validation panel in UI |
| 5 | "Add Custom Node" wizard |
| 6 | Full documentation site |

---

## 3. Phase 1: Foundation

**Duration:** 1 week
**Goal:** Create shared patterns library and establish context infrastructure

### 3.1 Tasks

| ID | Task | Effort | Owner |
|----|------|--------|-------|
| 1.1 | Create `shared/` directory structure | 2h | Dev |
| 1.2 | Extract `CollapsibleSection` component | 4h | Dev |
| 1.3 | Extract `ParameterInput` component | 6h | Dev |
| 1.4 | Extract `ParameterSelect` component | 4h | Dev |
| 1.5 | Extract `ParameterSwitch` component | 3h | Dev |
| 1.6 | Extract `InfoTooltip` component | 2h | Dev |
| 1.7 | Extract `ValidationMessage` component | 3h | Dev |
| 1.8 | Create `PipelineContext` wrapper | 4h | Dev |
| 1.9 | Create `NodeRegistryContext` skeleton | 2h | Dev |
| 1.10 | Update imports to use shared components | 6h | Dev |
| 1.11 | Review and test | 4h | Dev + Lead |

**Total:** ~40 hours (1 week)

### 3.2 Acceptance Criteria

- [ ] All shared components in `shared/` directory
- [ ] Each component has TypeScript props interface
- [ ] `PipelineContext` wraps existing `usePipelineEditor` hook
- [ ] No visual changes to application
- [ ] All existing tests pass

### 3.3 Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Hidden dependencies in extracted components | Medium | Low | Thorough testing after each extraction |
| Context re-render performance | Low | Medium | Memoize context values |

---

## 4. Phase 2: Node Registry

**Duration:** 2 weeks
**Goal:** Externalize node definitions to JSON and create registry API

### 4.1 Tasks

| ID | Task | Effort | Owner |
|----|------|--------|-------|
| 2.1 | Create `src/data/nodes/` directory structure | 2h | Dev |
| 2.2 | Define `NodeDefinition` JSON Schema | 4h | Dev |
| 2.3 | Define `ParameterDefinition` JSON Schema | 4h | Dev |
| 2.4 | Write extraction script for `stepOptions` | 8h | Dev |
| 2.5 | Extract preprocessing nodes to JSON | 4h | Dev |
| 2.6 | Extract splitting nodes to JSON | 3h | Dev |
| 2.7 | Extract model nodes to JSON | 4h | Dev |
| 2.8 | Extract remaining node types | 6h | Dev |
| 2.9 | Create `NodeRegistry` class | 8h | Dev |
| 2.10 | Implement registry loading from JSON | 6h | Dev |
| 2.11 | Create `useNodeRegistry` hook | 4h | Dev |
| 2.12 | Populate `NodeRegistryContext` with data | 4h | Dev |
| 2.13 | Add build-time JSON Schema validation | 6h | Dev |
| 2.14 | Generate TypeScript types from schema | 4h | Dev |
| 2.15 | Migrate `StepPalette` to use registry | 8h | Dev |
| 2.16 | Migrate `pipelineConverter` class mappings | 6h | Dev |
| 2.17 | Feature flag: enable registry-based loading | 2h | Dev |
| 2.18 | Testing and validation | 8h | Dev + QA |

**Total:** ~87 hours (~2 weeks)

### 4.2 Deliverables

1. `src/data/nodes/schema/node.schema.json`
2. `src/data/nodes/schema/parameter.schema.json`
3. `src/data/nodes/definitions/` with JSON files per category
4. `src/data/nodes/registry.ts` with `NodeRegistry` class
5. `src/contexts/NodeRegistryContext.tsx`
6. Updated `StepPalette` using registry

### 4.3 Feature Flag Strategy

During Phase 2, old and new systems coexist:

```typescript
// Feature flag configuration
const FEATURE_FLAGS = {
  USE_NODE_REGISTRY: process.env.REACT_APP_USE_NODE_REGISTRY === 'true',
};

// Usage in StepPalette
const nodes = FEATURE_FLAGS.USE_NODE_REGISTRY
  ? registry.getAllNodes()          // New: from JSON registry
  : convertStepOptionsToNodes();    // Old: from stepOptions

// Usage in pipelineConverter
const classPath = FEATURE_FLAGS.USE_NODE_REGISTRY
  ? registry.getNodeDefinition(type, name)?.classPath
  : CLASS_PATH_MAPPINGS[`${type}.${name}`];
```

**Coexistence Rules:**
1. Old `stepOptions` kept in codebase until flag 100% enabled
2. Automated tests run with flag both on and off
3. After 2 weeks of production with flag on, remove old code

### 4.4 Acceptance Criteria

- [ ] All nodes defined in JSON files (not TypeScript)
- [ ] JSON Schema validates all definitions at build time
- [ ] `StepPalette` renders nodes from registry
- [ ] `pipelineConverter` resolves class paths from registry
- [ ] Feature flag controls old vs new loading path
- [ ] No visual changes to application when flag enabled

### 4.5 Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Missing nodes during extraction | Medium | High | Automated comparison test |
| Schema too restrictive | Medium | Medium | Iterative schema refinement |
| Non-serializable defaults | High | Medium | Factory pattern for complex defaults |

---

## 5. Phase 3: Component Refactoring

**Duration:** 3 weeks
**Goal:** Split monolithic components, add lazy loading

### 5.1 Sprint 3A: StepConfigPanel Split (Week 1)

| ID | Task | Effort | Owner |
|----|------|--------|-------|
| 3.1 | Create `config/step-renderers/` directory | 1h | Dev |
| 3.2 | Extract `PreprocessingRenderer` | 6h | Dev |
| 3.3 | Extract `SplittingRenderer` | 4h | Dev |
| 3.4 | Extract `ModelRenderer` | 8h | Dev |
| 3.5 | Extract `BranchRenderer` | 4h | Dev |
| 3.6 | Extract `MergeRenderer` | 6h | Dev |
| 3.7 | Extract `GeneratorRenderer` | 6h | Dev |
| 3.8 | Extract remaining renderers | 8h | Dev |
| 3.9 | Create `useStepRenderer` hook with lazy loading | 4h | Dev |
| 3.10 | Refactor `StepConfigPanel` to thin orchestrator | 8h | Dev |

**Subtotal:** ~55 hours

### 5.2 Sprint 3B: Other Component Splits (Week 2)

| ID | Task | Effort | Owner |
|----|------|--------|-------|
| 3.11 | Split `TreeNode` into sub-components | 12h | Dev |
| 3.12 | Split `FinetuneConfig` into module | 8h | Dev |
| 3.13 | Add lazy loading for heavy panels | 4h | Dev |
| 3.14 | Add preloading on hover for FinetuneConfig | 3h | Dev |
| 3.15 | Reorganize directory structure | 6h | Dev |
| 3.16 | Update all imports | 4h | Dev |

**Subtotal:** ~37 hours

### 5.3 Sprint 3C: Context Migration (Week 3)

| ID | Task | Effort | Owner |
|----|------|--------|-------|
| 3.17 | Migrate `PipelineCanvas` to use context | 4h | Dev |
| 3.18 | Migrate `PipelineNode` to use context | 4h | Dev |
| 3.19 | Migrate `TreeNode` to use context | 6h | Dev |
| 3.20 | Migrate step renderers to use `useNodeRegistry` | 6h | Dev |
| 3.21 | Remove prop drilling from component chain | 4h | Dev |
| 3.22 | Performance testing and optimization | 6h | Dev |
| 3.23 | Final review and cleanup | 8h | Dev + Lead |

**Subtotal:** ~38 hours

**Phase 3 Total:** ~130 hours (~3 weeks)

### 5.4 Milestone Checkpoints

Phase 3 is the longest phase. Each week has a deployable checkpoint:

| Week | Milestone | Deployable State |
|------|-----------|------------------|
| 4 | StepConfigPanel split | All step renderers work, StepConfigPanel < 300 LOC |
| 5 | Component optimization | Lazy loading active, TreeNode split |
| 6 | Context migration | No prop drilling, full context usage |

**If delayed:** Week 4 milestone is most critical. Weeks 5-6 can be deferred with minimal impact.

### 5.5 Acceptance Criteria

- [ ] `StepConfigPanel` is < 300 lines
- [ ] Each step type has dedicated renderer file
- [ ] `TreeNode` is < 400 lines
- [ ] Heavy panels (StackingPanel, FeatureAugmentation) are lazy loaded
- [ ] No prop drilling for global state
- [ ] All existing functionality preserved

---

## 6. Phase 4: Validation System

**Duration:** 1.5 weeks
**Goal:** Implement multi-level validation with UI feedback

### 6.1 Tasks

| ID | Task | Effort | Owner |
|----|------|--------|-------|
| 4.1 | Create `validation/` directory | 1h | Dev |
| 4.2 | Implement parameter schema validator | 6h | Dev |
| 4.3 | Implement pipeline-level validator | 8h | Dev |
| 4.4 | Define validation rule set | 4h | Dev |
| 4.5 | Create `useValidation` hook | 4h | Dev |
| 4.6 | Add debounced parameter validation | 4h | Dev |
| 4.7 | Create `ValidationPanel` component | 8h | Dev |
| 4.8 | Add validation status to toolbar | 4h | Dev |
| 4.9 | Add inline validation errors to inputs | 6h | Dev |
| 4.10 | Create validation summary before export | 4h | Dev |
| 4.11 | Add "Validate Pipeline" button | 2h | Dev |
| 4.12 | Testing and edge cases | 8h | Dev + QA |

**Total:** ~59 hours (~1.5 weeks)

### 6.2 Acceptance Criteria

- [ ] Parameter errors show inline within 500ms of change
- [ ] Pipeline validation shows errors/warnings with severity
- [ ] "No model" warning displayed when pipeline has no model step
- [ ] "No splitter" info shown when model present without splitter
- [ ] Export blocked on errors (warnings allow proceed)
- [ ] Validation panel shows all issues with navigation

---

## 7. Phase 5: Custom Nodes

**Duration:** 2 weeks
**Goal:** Enable users to add their own operators

### 7.1 Tasks

| ID | Task | Effort | Owner |
|----|------|--------|-------|
| 5.1 | Design custom node wizard UI | 8h | Designer |
| 5.2 | Implement custom node storage (localStorage) | 6h | Dev |
| 5.3 | Create `CustomNodeEditor` component | 12h | Dev |
| 5.4 | Create `AddCustomNodeWizard` component | 8h | Dev |
| 5.5 | Add "Custom" section to StepPalette | 4h | Dev |
| 5.6 | Implement namespace validation | 4h | Dev |
| 5.7 | Implement security allowlist checking | 6h | Dev |
| 5.8 | Add custom node import/export | 6h | Dev |
| 5.9 | Implement workspace-level custom nodes | 8h | Dev |
| 5.10 | Admin controls for custom node policy | 6h | Dev |
| 5.11 | User documentation for custom nodes | 8h | Dev |
| 5.12 | Testing with real user scenarios | 8h | QA |

**Total:** ~84 hours (~2 weeks)

### 7.2 Security Allowlist Strategy

The allowlist controls which Python packages can be used in custom nodes:

**Package Categories:**

| Category | Behavior | Examples |
|----------|----------|----------|
| Core (always allowed) | Auto-included, immutable | `nirs4all`, `sklearn` |
| Synced from manifest | Updated with nirs4all releases | `scipy`, `numpy` |
| Admin-managed | Manually added by admin | `my_company.operators` |

**Implementation:**
```typescript
interface AllowlistConfig {
  core: string[];        // ['nirs4all', 'sklearn']
  synced: string[];      // From nirs4all manifest
  admin: string[];       // Admin-configured
}

function isPackageAllowed(classPath: string, config: AllowlistConfig): boolean {
  const packageRoot = classPath.split('.')[0];
  return [...config.core, ...config.synced, ...config.admin].includes(packageRoot);
}
```

### 7.3 Acceptance Criteria

- [ ] User can add custom preprocessing node
- [ ] Custom nodes appear in palette under "Custom" section
- [ ] Custom nodes are persisted across sessions
- [ ] Invalid class paths are rejected
- [ ] Custom nodes can be exported/imported
- [ ] Admin can disable custom nodes globally

### 7.4 MVP vs Full Feature

**MVP (Week 1):**
- Add custom node wizard (basic)
- localStorage persistence
- Namespace validation
- Palette integration

**Full Feature (Week 2):**
- Security allowlist
- Import/export
- Workspace-level storage
- Admin controls

---

## 8. Phase 6: Testing & Documentation

**Duration:** 2 weeks
**Goal:** Achieve test coverage targets, complete documentation

### 8.1 Tasks

| ID | Task | Effort | Owner |
|----|------|--------|-------|
| 6.1 | Unit tests for shared components | 16h | Dev |
| 6.2 | Unit tests for step renderers | 16h | Dev |
| 6.3 | Integration tests for validation | 8h | QA |
| 6.4 | E2E tests for custom node workflow | 8h | QA |
| 6.5 | Set up Storybook for shared components | 8h | Dev |
| 6.6 | Update inline documentation (JSDoc) | 6h | Dev |
| 6.7 | Write developer guide: Adding new nodes | 8h | Dev |
| 6.8 | Write developer guide: Creating custom nodes | 8h | Dev |
| 6.9 | Update README with new architecture | 4h | Dev |
| 6.10 | Performance benchmarking | 4h | Dev |
| 6.11 | Final code review | 8h | Lead |

**Total:** ~94 hours (~2 weeks)

### 8.2 Documentation Deliverables

1. **Developer Guide: Node System**
   - Adding a new built-in node
   - Node definition schema reference
   - Category configuration

2. **Developer Guide: Custom Nodes**
   - User workflow for custom nodes
   - Security model
   - Admin configuration

3. **Architecture Overview**
   - Component diagram
   - State management
   - Validation flow

4. **Storybook**
   - All shared components
   - Interactive playground

---

## 9. Risk Management

### 9.1 Risk Register

| ID | Risk | Probability | Impact | Mitigation | Owner |
|----|------|-------------|--------|------------|-------|
| R1 | Scope creep during refactoring | High | Medium | Strict phase boundaries, defer enhancements | Lead |
| R2 | Breaking changes to pipeline format | Medium | High | Backwards compatibility layer, migration tests | Dev |
| R3 | Performance regression from context | Medium | Medium | Profile before/after, memoization | Dev |
| R4 | Custom nodes introduce security issues | Medium | High | Allowlist validation, sandbox (future) | Dev |
| R5 | Team unfamiliarity with new patterns | Medium | Low | Documentation, pair programming | Lead |
| R6 | Delayed testing delays release | High | Medium | Testing in parallel with development | QA |

### 9.2 Contingency Plans

**If Phase 3 takes longer:**
- Phase 4 can start with just PreprocessingRenderer complete
- Validation can work with existing StepConfigPanel

**If custom nodes are deprioritized:**
- MVP can ship without custom nodes
- Phase 5 becomes future enhancement

---

## 10. Success Metrics

### 10.1 Technical Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| StepConfigPanel LOC | 2,561 | < 300 | `wc -l` |
| Bundle size (gzipped) | TBD | < +10% | Build output |
| Time to interactive | TBD | No regression | Lighthouse |
| Test coverage (shared) | 0% | > 90% | Coverage report |
| Test coverage (overall) | TBD | > 60% | Coverage report |

### 10.2 Developer Experience Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Time to add new node | < 30 min | Developer timing |
| Time to find component | < 1 min | Developer survey |
| Context switching (files touched per change) | < 3 files | Git analytics |

### 10.3 User Experience Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Validation error visibility | < 1s | Stopwatch |
| Custom node creation success | > 80% | User testing |
| No visual regressions | 0 | Visual diff testing |

---

## Appendix A: Weekly Schedule

### Week 1
- Phase 1: Foundation
- Setup shared components

### Week 2-3
- Phase 2: Node Registry
- Extract definitions, create registry

### Week 4-6
- Phase 3: Component Refactoring
- Split StepConfigPanel, context migration

### Week 7
- Phase 4: Validation (first half)
- Parameter and pipeline validation

### Week 8
- Phase 4 completion
- Phase 5: Custom Nodes start

### Week 9-10
- Phase 5: Custom Nodes completion

### Week 11-12
- Phase 6: Testing & Documentation
- Final polish and release

---

## Appendix B: Definition of Done

Each phase is complete when:

1. [ ] All tasks completed
2. [ ] Code reviewed and merged
3. [ ] Tests passing (unit + integration)
4. [ ] No regressions in existing functionality
5. [ ] Documentation updated
6. [ ] Stakeholder demo completed
7. [ ] Ready for deployment (behind flag if needed)

---

## Appendix C: Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-XX | 1.0 | Initial roadmap |
