# nirs4all-studio — Pre-v1 Technical-Debt Audit (2026-06-05)

Audit of `nirs4all-studio` at `main` @ `eba503f` (v0.6.3), treating the codebase as **pre-v1**: legacy/deprecated/backward-compat code counts as debt to **delete**, not preserve.

## Documents

| File | What it is |
|---|---|
| [`AUDIT_TECHNIQUE.md`](AUDIT_TECHNIQUE.md) | The full audit — **139 findings** across 15 areas, 8 cross-cutting themes, prioritized order. §0 lists the post-review corrections already folded in. |
| [`CODEX_REVIEW.md`](CODEX_REVIEW.md) | Independent Codex (gpt-5.5, read-only sandbox) verification of the audit against the real code: confirmed PCV-03 + 12/13 high-severity spot-checks, refuted one critical (PKG-01), found one missed bug (RUN-07). |
| [`ROADMAP.md`](ROADMAP.md) | The remediation plan, structured for **multiple parallel agents**: 24 tasks in 5 waves, file-collision map, dependency graph, green-gate rules, ≈3-week wall-clock estimate. |
| [`BASELINE.md`](BASELINE.md) | T0.0 green-gate baseline on `main` @ `eba503f` that every remediation commit was judged against. |
| [`CLOSEOUT.md`](CLOSEOUT.md) | **T4.1 final accounting**: per-finding status for all 139 IDs (137 fixed / 1 refuted / 1 wontfix), mechanical checks, perf & god-file scorecards, and the 7 library gaps flagged to nirs4all. |

## How it was produced

1. **16-agent parallel audit** (one auditor per area + an architect synthesis pass), each reading target files in full and cross-checking with the codegraph index, `grep`, and `ruff`. Every finding cites concrete `file:line` evidence.
2. **Codex review** of the resulting audit, verifying claims against the actual code.
3. **Corrections folded back** into the audit (§0), then the **multi-agent roadmap** written from the corrected findings.

## Headline numbers

- **139 findings:** 1 critical · 47 high · 59 medium · 32 low.
- **Top categories:** dead code (33), duplication (28), performance (21), legacy/compat (18), boundary violations (11), god classes (9), bugs (10).
- **4 root causes:** backend reimplements nirs4all (boundary erosion), half-landed V1→V2 migrations leaving a dead twin of everything, router-never-delegated god-classes, and blocking ML/IO on the asyncio event loop.
- **Expected cleanup:** ≥ −12,000 LOC net, 10 god-files (>2k LOC) → 0.

## Status: EXECUTED

The roadmap was executed in full on branch `techdebt/roadmap-2026-06-05` (2026-06-05/06): all 24 tasks across
the 5 waves plus two completion rounds that closed every remaining partial/deferral — including eight additive
APIs added to nirs4all (sibling branch `techdebt/studio-boundary-apis`, 8 commits). ~60 studio commits; gates
kept green throughout and upgraded vs baseline: eslint 0 errors, tsc 0, vitest 1,515, pytest 1,940, e2e 62/62
(suite made locally runnable for the first time); library unit tier 6,487. Final verdict: 137 fixed / 1
refuted / 1 wontfix. See [`CLOSEOUT.md`](CLOSEOUT.md) for the per-finding verdicts.
