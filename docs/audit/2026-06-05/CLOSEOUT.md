# Tech-Debt Roadmap Closeout — T4.1 (2026-06-06)

> Final accounting of the 2026-06-05 pre-v1 tech-debt audit ([`AUDIT_TECHNIQUE.md`](AUDIT_TECHNIQUE.md), 139 findings) after executing all 24 roadmap tasks on branch `techdebt/roadmap-2026-06-05`.

## Verdict

**139 findings:** 102 fixed · 22 partial · 13 deferred · 1 refuted · 1 wontfix.

Every `partial`/`deferred` carries a precise reason below — the dominant one is a **nirs4all library gap** (no pre-fit shape inference, no cancel hook, no public repetition/bias-variance analysis, no OFFSET/count store queries): the studio side is done and boundary-flag comments mark the exact API the library must grow.

## Mechanical checks (audit §T4.1)

| Check | Result |
|---|---|
| `ruff check api/ --select F401` | ✅ 0 errors (repo-wide ruff also green) |
| `ruff check .` | ✅ All checks passed |
| `.v2.` / vestigial `V2` filenames | ✅ none |
| dependency-drift checker (`lint:deps`) | ✅ 11 runtime packages in sync |
| `grep -ri deprecated/backward-compat api/ electron/` | ✅ 5 justified hits (see below) |
| `npm run lint:parallel` (eslint/tsc/nodes/ruff/deps) | ✅ exit 0 — eslint **0 errors** (baseline had 2) |
| `npx vitest run` | ✅ 84 files, 1,411 passed (baseline: 1 failure) |
| `pytest tests/ -n auto` | ✅ 1,936 passed (baseline: 891 — +1,045 incl. the 1,036-case resolver corpus) |
| `npm run build` + `build:electron` | ✅ both green |
| `npm run test:e2e` | ✅ 62/62 (first-ever local run — see addendum) |

### Justified residual grep hits

- `api/shared/filter_operators.py` legacy name mappings + `api/shared/dataset_config.py` na_policy aliases — **live shims repairing already-persisted user configs** (BL-11/DS-03, deferred to a v1 data-migration decision).
- `api/shared/runtime_grouping.py` deprecation **error message** telling users the removed `group` alias is gone.
- `api/workspace_manager.py` ×3 — comments inside the live `/workspace/recent` REST bridge (the methods are current API).

## Perf scorecard

| Metric | Before | After |
|---|---|---|
| Backend cold start (`import main`) | 2.77–3.08 s | **1.03–1.08 s (−63%)** |
| Event-loop blocking | workspace/playground/spectra/agg endpoints ran SQLite/parquet/sklearn inline | **40+ `asyncio.to_thread` offload sites**; `/execute` & `/execute-dataset` off-loop |
| Enriched-runs / inspector queries | per-run & per-pipeline N+1 fan-out | **set-based batched queries** with query-count assertion tests |
| Predictions pagination | page query + full-table re-query for the count | **single `COUNT(*)`** |
| Chart hot path | per-render Float32Array allocs, unmemoized WebGL, per-render LTTB | **memoized WebGL + hoisted decimation** |
| Run progress | fabricated % ramp + regex log-scraping into dead WS channels | **real progress** (pipelines done/total via JobManager) |
| Env detection | serial python spawns (6 ecosystems × 5 s) | **parallel probes** (Promise.all) |

## God-file scorecard (>2k LOC)

| File | Before | After |
|---|---|---|
| `api/workspace.py` | 4,388 | **package** (6 domain routers + services + models) |
| `src/api/client.ts` | 2,993 | **deleted** → transport + 14 domain modules |
| `api/playground.py` | 2,979 | **package** (8 modules) |
| `api/runs.py` | 2,321 | 1,813 (engine unified on JobManager) |
| `api/updates.py` | 2,254 | **package** (all modules ≤739) |
| `api/store_adapter.py` | 2,396→2,225 | 1,769 + extracted builder |
| `electron/env-manager.ts` | 2,148 | 1,155 + 6 env/ modules |
| `api/nirs4all_adapter.py` | 2,088 | ~950 |
| `api/workspace_manager.py` | 2,913 | ~2,160 (scanner extraction deferred) |

Residuals still >2k LOC (with their owners): `src/utils/pipelineConverter.ts` 2,868 (single converter by
design; PCV-06 model collapse deferred), `api/inspector.py` 2,330 (INS-04 analytics awaiting a library home),
`api/pipelines.py` 2,304 (PIPE-01 shape-math awaiting a library API; PIPE-02 discovery flip is a coordinated
contract change), `api/pipeline_canonical.py` 2,245 (the unified resolver itself), `api/workspace_manager.py`
2,153 (WorkspaceScanner extraction is the named follow-up seam). Each is a working single-responsibility-ish
module whose further shrink is gated on the deferred items above, not on unowned debt.

## LOC delta

Measured across the branch (`git diff --shortstat`, excluding docs and lockfile): 287 files,
37,147 insertions, 46,791 deletions = **net −9,644 lines** — and that net INCLUDES ~+1.9k of new tests and
~+1.2k of package-split scaffolding, so **≈ −12,700 LOC of production code was deleted** (dead converters ~3.4k, pywebview stack ~0.8k, dead builders ~1.5k, dead endpoints/classes ~1.7k, build mirrors ~1.05k, storybook, dead WS channels, F401 sweep ~190, dedup consolidations) offset by package-split scaffolding (+~1.2k of module headers/imports) and **+~1.9k LOC of new tests** (round-trip corpus, resolver corpus, characterization, regression, query-budget).

## Library gaps flagged to nirs4all (the boundary work the studio cannot do alone)

1. **Cancel hook** for in-flight `nirs4all.run()` (RUN-07 — stop currently takes effect between pipelines).
2. **Pre-fit shape inference** (operator + params + input shape → output shape) for the editor's propagate-shape (PIPE-01).
3. **Public bias-variance / robustness / learning-curve analysis** (INS-04).
4. **Store queries**: OFFSET + multi-value filters + count for rankings (INS-01); list-typed `run_id` on `query_aggregated_predictions` (T3.10 note).
5. **Repetition auto-detection** & preview binning parity (PG-06/PG-08).
6. **Dataset describe API** so link_dataset stops deriving task-type/targets in the router (WS-06 residual).
7. **Structured progress callback** for fold/variant-level UI progress (RUN-03 residual).

## Per-finding status (139)

| ID | Sev | Status | Resolution |
|---|---|---|---|
| `AGG-01` | high | ✅ fixed | T2.1: duplicated enrichment suite deleted; endpoints use canonical store_adapter helpers |
| `AGG-02` | medium | ✅ fixed | T0.3: precedence parenthesized; nested class/function payloads normalize; 4 regression tests |
| `AGG-03` | medium | ✅ fixed | T2.1: the N+1 was the legacy pairing's re-query — deleted with it |
| `AGG-04` | low | ✅ fixed | T2.1: deprecated aliases deleted (store_adapter aliases already gone in T1.1) |
| `BL-01` | high | ✅ fixed | = BV-01 |
| `BL-02` | high | ✅ fixed | = BV-02 |
| `BL-03` | medium | ✅ fixed | = BV-03 |
| `BL-04` | high | ✅ fixed | = WS-02 |
| `BL-05` | high | ✅ fixed | T1.6: api/shared/json_safe.py is the single sanitize implementation; all 5+3 copies deleted |
| `BL-06` | medium | ✅ fixed | T1.6: 187 F401 imports removed; 9 availability probes annotated; ruff repo-wide green |
| `BL-07` | low | ✅ fixed | = WS-03 |
| `BL-08` | low | ✅ fixed | T1.1: dead compat filter exports deleted |
| `BL-09` | medium | ✅ fixed | T1.1 deleted VenvManager.create_venv; T3.4 deleted the always-400 /venv/create endpoint + tests (route diff verified); orphaned frontend wrapper removed in T3.6 |
| `BL-10` | low | ✅ fixed | T1.2: no-op MinMaxScaler compat branch deleted |
| `BL-11` | medium | ⏳ deferred | LIVE shims repairing persisted user configs (commit 41d61fb); deletion needs a one-shot stored-config migration — explicit decision left to v1 data policy |
| `BL-12` | low | ✅ fixed | = RUN-04 |
| `BLD-01` | high | ✅ fixed | = PKG-03 |
| `BLD-02` | high | ✅ fixed | T0.4: storybook config+stories+eslint plugin+static output deleted |
| `BLD-03` | medium | ✅ fixed | = PKG-04 |
| `BLD-04` | low | 🟡 partial | T0.4: type-check + lint:py-syntax + ci:local* removed; lint/test + lint:eslint/test:frontend pairs kept (each has a distinct live consumer: CI vs :parallel lanes) |
| `BLD-05` | medium | ✅ fixed | T0.4: ci:local* family + scripts/ci-local.cmd deleted (ci:docker:* is the cross-platform path) |
| `BLD-06` | low | ✅ fixed | T0.4: encoding + @tailwindcss/typography removed; lockfile pruned |
| `BLD-07` | low | ✅ fixed | T0.4: lint:py-syntax lane + scripts/check-py-syntax.py deleted (ruff E999 covers it) |
| `BLD-08` | low | ✅ fixed | T0.4: @types/three to devDependencies; .mcp.json untracked |
| `BM-01` | high | ✅ fixed | T1.5: spawn path deduped into spawnBackend() |
| `BM-02` | medium | ✅ fixed | T1.5: readiness poll generation-counted and cancelled on teardown |
| `BM-03` | medium | ✅ fixed | T1.5: orphan kill awaits taskkill exit (bounded fallback) |
| `BM-04` | low | ❌ refuted | T1.5: all four launch-mode env vars have independent live consumers in api/system.py, api/updates.py, api/recommended_config.py — not collapsible |
| `BV-01` | high | ✅ fixed | T1.2: legacy editor-format builder subtree deleted |
| `BV-02` | high | ✅ fixed | T1.2: native-format builder block deleted |
| `BV-03` | medium | ✅ fixed | T1.2: dead YAML import/export deleted |
| `BV-04` | high | ✅ fixed | T2.2: one registry-driven resolver (resolve_editor_class_path + import_operator_class); module-scan lists deleted; 1,036-case corpus test |
| `BV-05` | medium | ✅ fixed | T2.2: one normalize_params with merged special cases |
| `BV-06` | high | ✅ fixed | T2.1: refit<->CV signature pairing deleted — modern nirs4all stores refit on the SAME chain row (verified in library source); synthetic-final fallback kept as documented presentation policy |
| `BV-07` | medium | 🟡 partial | T2.1: _FullTrainFoldSplitter internal-name detection deleted; has_refit chain-derived; repr-string guard added. Remaining: CV config inference reads user-authored canonical config; the splitter->strategy map is documented UI vocabulary over PUBLIC class names; a library-persisted runtime config would replace inference (LIBRARY GAP) |
| `BV-08` | medium | 🟡 partial | T3.10: enriched-runs builder extracted (store_adapter 2,225->1,769); helpers kept in place to preserve the 8-importer fan-out (explicitly allowed seam) |
| `BV-09` | medium | ✅ fixed | T2.2: python export emits canonical repr; string templaters deleted |
| `BV-10` | low | ✅ fixed | T1.2: extract_metrics_from_prediction + its training.py import deleted |
| `BV-11` | low | ✅ fixed | T2.2: alias maps moved into registry definition JSONs (legacyClassPaths/aliases) |
| `CLIENT-01` | high | ✅ fixed | T3.6: client.ts (2,993 LOC) deleted; transport core + 14 per-domain modules; ~90 importers updated; zero @/api/client imports |
| `CLIENT-02` | medium | ✅ fixed | T3.6: one parseResponseError/toApiError shared by all request paths |
| `CLIENT-03` | medium | ✅ fixed | T1.3: dead client exports deleted |
| `CLIENT-04` | high | ✅ fixed | T3.6: AxiosLikeClient + apiClient + venv aliases + dead useCreateVenv deleted |
| `CLIENT-05` | medium | ✅ fixed | T3.6: fetchWithRetry transport core with AbortSignal pass-through |
| `CLIENT-06` | low | ✅ fixed | T3.6: inlined response shapes promoted to named interfaces |
| `DS-01` | high | ✅ fixed | T2.3: private parser internals access removed; public FolderParser.parse everywhere |
| `DS-02` | medium | ✅ fixed | T2.3: detection block deduped; characterization tests pin the JSON contract |
| `DS-03` | low | ⏳ deferred | = BL-11 (same na_policy shim) |
| `DS-04` | low | ✅ fixed | T2.3: write-back only when stored stats are missing |
| `ENV-01` | high | 🟡 partial | T3.9: EnvManager 2,148->1,155 + six electron/env/ modules; coordinator still >800 (residual settings/paths/runtime-mode seam flagged) |
| `ENV-02` | medium | ✅ fixed | T1.5: dead getRuntimeMode/validatePortableState deleted |
| `ENV-03` | medium | ✅ fixed | T1.5: customPythonPath legacy migration branch deleted |
| `ENV-04` | low | ✅ fixed | T1.5: envRoot derivations unified on getEnvRootForPythonPath |
| `ENV-05` | medium | 🟡 partial | T3.9: probes + per-candidate checks Promise.all-parallelized; win unmeasurable under mocked child_process |
| `ENV-06` | low | 🟡 partial | T1.5: envRoot half done (=ENV-04); probe-list unification refuted — api/network_state.py performs no HTTP probe; no backend host list exists |
| `FE-01-reg` | high | ✅ fixed | T1.3: shim deleted; NodeRegistryContext.v2 renamed canonical |
| `FE-01-state` | high | ✅ fixed | T0.3: SelectionContext keyboard effect removed; usePlaygroundShortcuts is the single owner; regression test |
| `FE-02-reg` | high | ✅ fixed | T1.3: USE_NODE_REGISTRY flag + Phase-1 branch + isJsonRegistry plumbing deleted |
| `FE-02-state` | high | ✅ fixed | T1.3: dead selector-store/Hover machinery deleted |
| `FE-03-reg` | medium | ✅ fixed | T1.3: V2 suffixes dropped (SpectraChart, FoldDistributionChart) |
| `FE-03-state` | medium | ✅ fixed | T1.3: dead DatasetBinding render block + feeder deleted |
| `FE-04-reg` | low | ✅ fixed | T1.3: YHistogramV2 re-export shim deleted |
| `FE-04-state` | medium | ✅ fixed | T3.8: polling interval stable on [runStatus, runId] |
| `FE-05-reg` | medium | ✅ fixed | T1.3: dead @deprecated chartConfig helpers deleted |
| `FE-05-state` | medium | 🟡 partial | T3.8: shared pushHistory helper (15 inline blocks gone, -101 LOC); full context merge needs a dedicated card |
| `FE-06-reg` | medium | 🟡 partial | T1.3: FOLD_COLORS/getSampleColorByY deleted (comment-only refs); SELECTION_COLORS kept — live SpectraWebGL feeds THREE.Color which cannot resolve CSS-var HIGHLIGHT_COLORS (audit migration not behavior-equivalent) |
| `FE-06-state` | medium | ⏳ deferred | Predictions.tsx god-page split: no roadmap card (post-roadmap god-page splits per VIZ-03 note) |
| `FE-07-reg` | low | 🟡 partial | Recharts scaffolding duplication reduced via T3.7 shared selection helpers; full chart unification is post-roadmap |
| `FE-07-state` | medium | ⏳ deferred | RunProgress god-page split: no roadmap card (post-roadmap); its worst bug (polling churn) fixed in T3.8 |
| `FE-08-state` | low | 🚫 wontfix | Provider granularity is an architectural preference; no measured cost; revisit if profiling shows context-churn |
| `FE-09-state` | low | ✅ fixed | follow-up commit: effect syncs initialDetectedOutliers prop changes (no more initialize-once) |
| `FE-10-state` | low | ✅ fixed | follow-up commit: hasSession is state updated by save/clear in both session contexts (no render-time storage reads) |
| `FE-11-state` | low | ✅ fixed | T1.3: always-true branches collapsed, behavior preserved |
| `INS-01` | high | 🟡 partial | T3.3: /data single-pass + query-budget test (2+1+0 store calls); /rankings keeps Python sort+slice — store lacks OFFSET/multi-filter/count (LIBRARY GAP) |
| `INS-02` | medium | ✅ fixed | T3.3: pipeline-metadata N+1 -> one list_pipelines batch |
| `INS-03` | low | ✅ fixed | T1.1: dead helpers + unused models deleted |
| `INS-04` | medium | ⏳ deferred | T3.3: nirs4all exposes no public bias-variance/robustness/learning-curve analysis; math boundary-flag-commented in place (LIBRARY GAP) |
| `INS-05` | low | ✅ fixed | T3.3: metric direction from nirs4all get_metric_info (single source with store ranking) |
| `PCV-01` | high | ✅ fixed | T1.3: nativePipelineFormat.ts (1,695 LOC) + its test deleted |
| `PCV-02` | high | ✅ fixed | = PCV-01 (single converter remains) |
| `PCV-03` | critical | ✅ fixed | T0.1: scalarGeneratorConfig is the single source of truth in both converter directions; 10 round-trip tests |
| `PCV-04` | high | ✅ fixed | T0.1: merge export whitelists canonical keys only |
| `PCV-05` | medium | ✅ fixed | T0.1: y_processing import honors inline sibling params |
| `PCV-06` | high | ⏳ deferred | T3.8: collapsing parallel step representations requires step-renderer edits beyond the card (cross-cutting follow-up) |
| `PCV-07` | medium | 🟡 partial | T3.8: zero-caller members deleted; 5 deprecated symbols have live UI callers — migrate to useVariantCount hook then delete ~250 LOC |
| `PCV-08` | medium | ⏳ deferred | T3.8: registry swap NOT behavior-preserving today — frontend registry JSONs carry sklearn-PRIVATE primary classPaths (registry bug found and flagged); fix registry first |
| `PERF-01` | high | ✅ fixed | T3.5: sole eager nirs4all import deferred; cold start 2.77-3.08s -> 1.03-1.08s (-63%); nirs4all/sklearn no longer in sys.modules at import main |
| `PERF-02` | high | ✅ fixed | T3.2: /execute & /execute-dataset via asyncio.to_thread |
| `PERF-03` | high | ✅ fixed | T3.5: all four spectra handlers offload parquet/materialization via asyncio.to_thread |
| `PERF-04` | medium | ✅ fixed | T3.5: bounded 4-entry LRU replaces the unbounded module-level dataset cache |
| `PERF-05` | medium | 🟡 partial | T3.5: max_wavelengths_returned LTTB decimation param added (default-off = today's payloads); UI wiring is the follow-up |
| `PERF-06` | medium | ✅ fixed | T2.1: the three chain-summary endpoints run store work via asyncio.to_thread |
| `PG-01` | high | ✅ fixed | T3.2: api/playground/ package; executor is thin orchestration |
| `PG-02` | high | ✅ fixed | T1.1: dead /metrics endpoint family deleted (-173 LOC) |
| `PG-03` | medium | ✅ fixed | T1.1: dead imports removed |
| `PG-04` | high | 🟡 partial | T3.2: inline duplication extracted to one helper; full unification with metrics_computer would change the /repetitions response (different reference modes/spaces) |
| `PG-05` | medium | ✅ fixed | T3.2: one TTLCache (TTL+LRU+byte budget, O(1) eviction) |
| `PG-06` | medium | ⏳ deferred | T3.2: nirs4all exposes no public repetition auto-detection API (LIBRARY GAP) |
| `PG-07` | medium | ⏳ deferred | T3.2: removing .tolist() requires ORJSON OPT_SERIALIZE_NUMPY on the global response class — app-wide serialization change, own card |
| `PG-08` | low | ⏳ deferred | T3.2: library BinningCalculator (10-bin) does not match the playground 5-bin percentile preview shim (LIBRARY GAP) |
| `PIPE-01` | high | ⏳ deferred | T2.2: nirs4all has NO pre-fit shape-inference surface (n_features_out_ is fitted-only); hand-math kept with boundary-flag comment stating the required library API (LIBRARY GAP) |
| `PIPE-02` | medium | ⏳ deferred | T2.2: registry-driven discovery validated (resolves all operator families) but flipping the six allow-lists 3x-expands the frontend palette — contract change needing frontend coordination |
| `PIPE-03` | low | ✅ fixed | T2.2: comment filtering unified on filter_canonical_comments (10 call sites) |
| `PKG-01` | medium | ✅ fixed | T0.2: orjson+msgpack in all packaged sources (Codex had downgraded: guarded import, silent degradation) |
| `PKG-02` | high | ✅ fixed | T0.2: BACKEND_COMMON_PACKAGES canonical + scripts/check-dep-sync.cjs in green gate + CI |
| `PKG-03` | high | ✅ fixed | T0.4: pywebview stack deleted (build.py, nirs4all-webapp.spec, launcher.py) |
| `PKG-04` | medium | ✅ fixed | T0.4: electron-builder.yml deleted; build-test/config tests updated |
| `PKG-05` | medium | ✅ fixed | T0.4: sh/cmd/ps1 build mirrors deleted; docs point at npm run release |
| `PKG-06` | low | ✅ fixed | T0.2: backend.spec uses collect_submodules(api/websocket/updater); nirs4all-webapp.spec deleted (T0.4) |
| `PRED-01` | high | ✅ fixed | T1.1: dead single/confidence/explain prediction endpoints + helper stack deleted (-484 LOC) |
| `RUN-01` | high | ✅ fixed | T1.4: run execution unified on JobManager (job id = run id); bespoke engine deleted |
| `RUN-02` | high | ✅ fixed | T1.4: one NaN-safe extract_best_metrics shared by runs/pipelines/training (probed against real RunResult: best_* all NaN; predictions.top carries the metric) |
| `RUN-03` | medium | ✅ fixed | T1.4: regex scraper + synthetic ramp deleted; fold/branch/variant/job_log WS channels had ZERO frontend consumers and are deleted; progress is real (pipelines done/total) |
| `RUN-04` | medium | ✅ fixed | T1.4: legacy double-nested scan deleted |
| `RUN-05` | low | ✅ fixed | T1.4: _create_mock_run + no-op encoder override deleted |
| `RUN-06` | medium | ✅ fixed | T1.4: rmse=999/r2=0 fabrication deleted; metrics stay None; tests assert the honest contract |
| `RUN-07` | high | 🟡 partial | T1.4: stop is real at the run level — cancellation honored between pipelines, terminal status never overwritten (regression test); cosmetic pause/resume deleted both ends. Mid-pipeline abort needs a nirs4all cancel hook (LIBRARY GAP) |
| `UPD-01` | high | ✅ fixed | T3.4: api/updates/ package, all modules <=739 LOC; patch paths preserved |
| `UPD-02` | medium | 🟡 partial | T1.1: no-op filter helper inlined + dead /webapp/download deleted; _LazyUpdateManager KEPT — live via api/network_state.py + 11 endpoints (audit overstated) |
| `UPD-03` | low | ✅ fixed | T3.4: 30s-TTL online-probe cache; explicit timeouts; to_thread fallback; asyncio.run instead of manual loop dance |
| `VIZ-01` | high | ✅ fixed | T3.7: SpectraWebGL memoized; LTTB hoisted; sampleColors stabilized |
| `VIZ-02` | high | ✅ fixed | T3.7: per-render Float32Array allocation removed (memoized children) |
| `VIZ-03` | high | 🟡 partial | T3.7: selection scaffolding extracted to shared hooks (the audit-planned incremental step); full god-component split is explicitly post-roadmap |
| `VIZ-04` | medium | ✅ fixed | T3.7: shared selectionHandlers.ts (geometry helpers defined once; 8 tests) |
| `VIZ-05` | medium | 🟡 partial | T3.7: chartData memoization verified correct; WebGL path optimized; Recharts SVG per-line recolor-on-hover left (Cell refactor with stale-props risk) |
| `VIZ-06` | medium | ✅ fixed | T1.3: getYMeanColor + unreachable metric color mode deleted |
| `VIZ-07` | medium | 🟡 partial | = FE-05/06-reg (SELECTION_COLORS exception) |
| `VIZ-08` | low | 🟡 partial | T1.3: dead colorMode machinery removed; barOrientation horizontal variant kept (behavior-touching rewrite, low severity) |
| `VIZ-09` | medium | ⏳ deferred | T3.7: backend outlier_indices already exists; switching the frontend fallback off is a UI-contract decision (boundary flag) |
| `WS-01` | high | ✅ fixed | T3.1: api/workspace/ package (6 domain routers + services + models); route table byte-identical (318) |
| `WS-02` | high | ✅ fixed | T1.1: DatasetRegistry/SchemaMigrator/RunManager deleted (-739 LOC) |
| `WS-03` | medium | ✅ fixed | T1.1: dead StoreAdapter methods + deprecated aliases deleted; tests retargeted |
| `WS-04` | high | ✅ fixed | T3.1: 40 asyncio.to_thread offload sites; executor.map loop-blocker gone |
| `WS-05` | high | ✅ fixed | T3.10: set-based queries keyed by page run_ids; N+1 gone (query-count test) |
| `WS-06` | high | 🟡 partial | T2.1: ds._metadata/_targets private access replaced by public accessors; legacy refit-pipeline detection deleted. Remaining: task-type/target derivation is response formatting; a library-side dataset-describe API would absorb it (LIBRARY GAP) |
| `WS-07` | medium | 🟡 partial | T3.1+follow-up: dead get_workspace_runs wrapper deleted; the legacy-parquet readers are isolated named helpers in router_discovery ready to move into WorkspaceScanner when the scanner is extracted from workspace_manager (deferred: the move would grow the 2.1k-LOC module today) |
| `WS-08` | low | ✅ fixed | T3.10: both get_all_chains_* on one shared _chains_payload |
| `WS-09` | medium | 🟡 partial | follow-up commit: public app_config.rename_dataset_group (no private reach); dead app_data_dir field deleted; honest docstrings (the 'Legacy:' recents methods BACK the live /workspace/recent contract). Thin delegators kept: one-line passthroughs with live callers |
| `WS-10` | medium | ✅ fixed | T3.10: single COUNT(*) with identical filters replaces the second full-table query |

## Deviations from the roadmap process

- Executed sequentially-per-wave on ONE integration branch (`techdebt/roadmap-2026-06-05`) with per-task commits instead of branch-per-task PRs — single-orchestrator execution; every wave gated on the full lint+test suite before the next began (the per-task gate evidence is in each commit message).
- Workflow agents normalized CRLF→LF in files they rewrote (whole-file diff churn in some Wave-1 commits; content deltas are stated per commit).
- `npm run test:e2e` was not part of the recorded T0.0 baseline — it had NEVER been runnable locally: the
  Playwright webServer pointed at a nonexistent `../.venv` (fixed to `../nirs4all/.venv`), and the chromium
  binary was not installed. Once runnable, 61/62 passed; the one failure
  (`workflow.spec.ts › should view run details if runs exist`) was a latent test-vs-UI mismatch that CI never
  exercised (its `if (runCount > 0)` guard is vacuous on CI's empty workspace): the test clicked the run row
  (which expands the accordion) instead of the Details button (which opens the sheet). Test corrected to the
  real interaction contract; full workflow spec green (screenshot-verified the page itself renders and
  functions correctly).
