# Playground V1 Documentation Index

**Last Updated**: January 2026

This folder contains internal technical documentation for the Playground V1 feature.

---

## Documents

| Document | Description |
|----------|-------------|
| [State Review](./PLAYGROUND_STATE_REVIEW.md) | Analysis of current playground implementation, gaps, and compatibility with Pipeline Editor |
| [Backend Capabilities](./NIRS4ALL_BACKEND_CAPABILITIES.md) | Assessment of nirs4all's ability to power real-time preprocessing |
| [Specifications](./PLAYGROUND_SPECIFICATIONS.md) | Detailed functional and technical specifications for V1 |
| [Implementation Roadmap](./PLAYGROUND_IMPLEMENTATION_ROADMAP.md) | Phased implementation plan with tasks and timeline |

---

## Quick Reference

### Key Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| Processing | Backend (nirs4all StepRunner) | Accuracy, extensibility, splitter support |
| Transport | HTTP + debounce (V1) | Simpler than WebSocket; evaluate SSE for V2 |
| Operator format | Unified with Pipeline Editor | Consistency, bidirectional import/export |
| Operator types | Preprocessing + Splitters | Fold visualization requirement |
| Charts | Recharts (optimize later) | Already in use, evaluate ECharts for WebGL |
| Caching | Frontend (React Query) + Backend (LRU) | Performance for repeated queries |
| Per-step comparison | Pipeline slicing (re-execute prefix) | Avoids large intermediate payloads |

### Key API Design Decisions

| Topic | Decision |
|-------|----------|
| Response payloads | Subset-only for spectra/PCA; Full for statistics |
| Fold schema | Summary always + fold_labels for PCA; full indices only if n_splits ≤ 10 |
| React Query keys | Stable hashes, not object identity |
| Slider handling | `onValueCommit` instead of debounced `onChange` |

### Timeline

- **Week 1**: Backend API with StepRunner + splitter support
- **Week 2**: Frontend integration
- **Week 3**: Visualization upgrade + fold charts
- **Week 4**: Polish, export, buffer & contingency

### Critical Success Factors

1. **<200ms** pipeline execution for typical datasets
2. **Accurate** nirs4all operator results (not JS approximations)
3. **Splitter support** with fold distribution visualization
4. **Bidirectional** import/export with Pipeline Editor
5. **Stable caching** to prevent unnecessary re-computation

---

## Navigation

- **Start here**: [State Review](./PLAYGROUND_STATE_REVIEW.md) for current state analysis
- **Technical details**: [Backend Capabilities](./NIRS4ALL_BACKEND_CAPABILITIES.md) and [Specifications](./PLAYGROUND_SPECIFICATIONS.md)
- **Implementation**: [Roadmap](./PLAYGROUND_IMPLEMENTATION_ROADMAP.md) for development plan
