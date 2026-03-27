Findings

High: Issue #7 is confirmed in Step 4. Y-column detection ignores the parsing choices made in the wizard. In web mode, the wizard re-reads the raw file and guesses the delimiter with a local heuristic using line.split(...); in desktop mode, it calls detectFormat({ path }) with no wizard overrides. Neither path uses state.perFileOverrides or the delimiter manually set in Step 3. That means changing Y from ; to , in the wizard cannot affect target detection. See TargetsStep.tsx (line 190).

High: The “manual separator override” also gets ignored during validation, so the wizard can tell the user their override failed even when the UI stored it correctly. The wizard sends only global parsing to validation, not per-file overrides, and the backend loads X/Y with only those global values. See index.tsx (line 141) and datasets.py (line 804).

High: Actual run/training execution drops per-file overrides before calling nirs4all, so even when preview/import partly works, execution can still use the wrong delimiter/decimal settings. build_dataset_config() maps files but never forwards file_info["overrides"]. This path is used by both runs and training. The library itself does support file-specific params, so this is a webapp integration bug, not a library limitation. See nirs4all_adapter.py (line 123), runs.py (line 1119), training.py (line 444), and config.py (line 1510).

High: Browser/web-mode preview appears broken outright. The frontend posts uploaded files to /datasets/preview-upload, but I found no backend route for that endpoint; the backend only exposes /datasets/preview. Since preview success is what unlocks the final step, browser-mode import can get stuck. See PreviewStep.tsx (line 71), client.ts (line 580), datasets.py (line 854), and WizardContext.tsx (line 441).

High: Dataset import is translated into nirs4all through several different builders with different behavior. Preview uses one builder, stored-dataset loading uses another, run/training uses another, and dataset preview by id has its own inline translation. They do not forward the same fields and do not share the same defaults. This is the main architectural reason import behavior is inconsistent across wizard, dataset page, spectra views, and execution. See datasets.py (line 224), datasets.py (line 990), spectra.py (line 54), and nirs4all_adapter.py (line 123).

High: The wizard-level taskType is effectively disconnected. State initializes to "auto" and the reducer supports SET_TASK_TYPE, but I found no UI dispatch that ever sets it. Changing target type only updates state.targets. The wizard still saves task_type: state.taskType, so datasets are stored with stale "auto" even after explicit user choices. See WizardContext.tsx (line 58), WizardContext.tsx (line 217), TargetsStep.tsx (line 313), TargetsStep.tsx (line 326), and index.tsx (line 430).

High: Repetition/aggregation controls are not wired into nirs4all. The UI exists and the wizard stores an aggregation object, but none of the backend config builders translate it to the library fields aggregate and aggregate_method. So the repetition column/method UI is currently mostly a no-op. See TargetsStep.tsx (line 576), index.tsx (line 430), and config.py (line 1268).

High: Fold-file handling is also disconnected. Detection and UI exist, and dropped folders/files do carry fold-file info into initial wizard state, but submit never includes folds, and none of the config builders forward it even though the library supports it. Fold-file detection therefore does not survive into actual dataset loading. See Datasets.tsx (line 171), TargetsStep.tsx (line 646), index.tsx (line 430), and config.py (line 1325).

Medium: Issue #1 is only partially addressed. The repetition-column selector prefers metadata columns, but if metadata detection fails it silently falls back to target columns from Y. Metadata detection itself is loaded using parsing inferred from the first X file, so if metadata uses different parsing the wizard regresses to the old wrong behavior. See TargetsStep.tsx (line 593), datasets.py (line 388), and datasets.py (line 577).

Medium: The user-selected default_target is lost during linking. The wizard saves it into config, but /datasets/link only copies targets from config and then, if no top-level default_target exists, rewrites it to the first target. It never reads config["default_target"]. See index.tsx (line 439) and workspace.py (line 271).

Medium: Preview paths do not honor all wizard parsing controls. The wizard exposes encoding and na_policy, but the preview request model and preview config builder only carry delimiter, decimal separator, header, header unit, and signal type. That means preview is not a faithful representation of what the user configured. See ParsingStep.tsx (line 543), ParsingStep.tsx (line 637), datasets.py (line 107), and datasets.py (line 224).

Medium: Stored-dataset loading has inconsistent defaults depending on which backend path is used. spectra.py falls back to comma as delimiter, while workspace defaults are semicolon; wizard fallback defaults also differ from workspace defaults for header_unit (cm-1 vs nm). Incomplete dataset configs can therefore load differently across views. See spectra.py (line 64), workspace.py (line 1164), workspace_manager.py (line 2509), and WizardContext.tsx (line 26).

Medium: Workspace default na_policy is internally inconsistent. Backend default is "drop", but the frontend types and settings UI only allow "auto", "abort", "remove_sample", "remove_feature", "replace", and "ignore". A stored default can therefore be outside the UI vocabulary. See workspace_manager.py (line 2509), datasets.ts (line 35), and DataLoadingDefaultsForm.tsx (line 315).

Low: Desktop manual file selection enters the wizard through a weaker path than drag/drop or “add files”. SourceStep builds files as unknown without backend detection, while FileMappingStep uses detectFilesList() for the other entry paths. The same dataset can therefore produce different initial wizard state depending on how the user selected files. See SourceStep.tsx (line 173) and FileMappingStep.tsx (line 257).

Low: The dataset page edit panel also has disconnected controls. It loads taskType and signalType into local state and renders selectors for them, but save only persists default_target and parsing config, and the parsing save path uses parsingSignalType instead of the visible signalType field. So some dataset-page controls look editable but do not update the dataset. See EditDatasetPanel.tsx (line 148), EditDatasetPanel.tsx (line 220), and EditDatasetPanel.tsx (line 494).

Testing Gap

I found no test coverage for the import-specific backend routes (/datasets/preview, validate-files, detect-unified, detect-files-list, auto-detect) or for the wizard components themselves. Given the number of “UI control exists but downstream path ignores it” regressions, this part of the app is currently under-protected.


-----------------------------------------


Implementation Order

Unify config translation first.
Rewire wizard steps to use that same translation path.
Add regression tests around the exact issue flows before doing UI polish.
Backend Translators

Create one canonical “webapp dataset config -> nirs4all config” translator and make every path call it: preview, stored dataset preview, link/stat enrichment, run, and training. Today the logic is split across datasets.py, spectra.py, nirs4all_adapter.py, and the inline dataset-preview-by-id path in datasets.py.

The canonical translator should always merge:
global_params: delimiter, decimal_separator, has_header, encoding, na_policy, na_fill_config.
train_x_params / test_x_params: X-specific params plus per-file overrides.
train_y_params / test_y_params: per-file overrides for Y.
train_group_params / test_group_params: per-file overrides for metadata/group files.
This is the missing piece behind issue #7. The library already supports this merge model in config.py.

Translate wizard aggregation to the library’s actual fields:
aggregation.column -> aggregate
aggregation.method -> aggregate_method
Wire this from saved dataset config into preview/load/run paths.

Translate folds explicitly.
state.folds or detected fold-file path needs to become folds in the final nirs4all config, instead of being dropped on submit.

Preserve default_target correctly during linking. The link/enrichment path in workspace.py should read the configured default target instead of replacing it with the first target.

Normalize defaults in one place. Right now delimiter, header_unit, and na_policy defaults disagree across WizardContext.tsx, workspace.py, workspace_manager.py, and spectra.py. Fix the vocabulary mismatch before touching more UI.

Validation should use the same effective per-file loading params as preview/run. The current /datasets/validate-files path in datasets.py is too shallow and is the reason overrides appear ignored.

Wizard / Dataset Page Wiring

Source/file-selection paths should converge. Manual file selection in SourceStep.tsx should go through the same detection/enrichment flow as drag-drop and “Add files” in FileMappingStep.tsx.

Parsing Step should remain the only place where parsing choices are edited, but every downstream step must consume the effective settings from state, including perFileOverrides. The reducer/state shape in WizardContext.tsx is already close; the downstream reads are not.

Targets Step needs the biggest rewrite in behavior, not UI. Y-column detection in TargetsStep.tsx must stop re-guessing parsing from raw file text and instead request columns using the chosen effective params. Same for metadata-column loading.

For issue #1, the repetition column should not silently fall back to Y columns when metadata parsing failed. Either block that branch with a warning, or make the fallback explicit in the UI.

taskType needs one source of truth. Either derive it from selected targets at submit time, or dispatch SET_TASK_TYPE when target types change. Right now the dataset stores stale "auto" even after target-type edits.

Preview Step should call a real backend route. Either add the missing upload preview endpoint, or change client.ts and PreviewStep.tsx to use an existing supported path.

Submit from index.tsx should persist the full import contract:
files with overrides, targets, default_target, resolved task_type, aggregation, folds, and full parsing/global params.

The dataset page editor in EditDatasetPanel.tsx should be reviewed after the wizard. Some visible controls are currently not persisted, so it will otherwise reintroduce stale config.

Tests To Add

Backend translator parity tests: same dataset config should produce equivalent effective nirs4all config from preview, stored preview, run, and training paths.

Backend regression test for issue #7: X and metadata use one delimiter, Y override is different, and manual Y override must survive validation, preview, and run config generation.

Backend regression test for issue #1: metadata columns are parsed from metadata using metadata-effective params, and repetition-column choices do not silently revert to Y when metadata parsing fails.

Backend test for folds: detected or manual fold config survives submit and appears in the final nirs4all config.

Backend test for default_target: configured default survives link and dataset reload.

Frontend wizard tests around ParsingStep.tsx, TargetsStep.tsx, and PreviewStep.tsx:
per-file override updates state,
target detection uses override-aware backend data,
preview step calls a valid endpoint,
final submit payload includes aggregation and folds.

One end-to-end import test matrix with:
semicolon X/Y/M,
comma Y with semicolon X,
metadata requiring its own parsing,
dataset with fold file,
browser-mode upload preview.

----------------


Execution Order

Canonical backend translator

Validation and detection parity

Wizard step rewiring

Preview upload path

Dataset link/edit consistency

Regression tests

Canonicalize dataset config translation

Scope: create one backend function that converts stored/webapp dataset config into the exact nirs4all dataset config used everywhere.

Files: datasets.py, spectra.py, nirs4all_adapter.py, optionally a new helper module such as api/dataset_config_adapter.py

Acceptance criteria:

Preview, stored dataset preview, run, and training all call the same translator.
Per-file overrides are forwarded to train_x_params, train_y_params, train_group_params, test_*_params as applicable.
Global parsing fields are forwarded consistently: delimiter, decimal separator, header, encoding, NA policy, NA fill config.
Aggregation is translated to aggregate and aggregate_method.
Folds are translated to folds.
Defaults are no longer hardcoded differently across call sites.
Make validation use effective file params
Scope: /datasets/validate-files must validate X/Y with the same effective params the preview/run path will use.

Files: datasets.py, client.ts, index.tsx

Acceptance criteria:

Validation request includes file overrides, not only global parsing.
Shape validation respects a Y-specific delimiter override.
A dataset that previews successfully with overrides also validates successfully with the same overrides.
Issue #7 is reproducible before the change and closed by this path after the change.
Rewire target and metadata detection to use chosen parsing
Scope: Step 4 must stop re-detecting parsing independently and instead load Y/metadata columns through the backend using effective wizard params.

Files: TargetsStep.tsx, datasets.py, client.ts

Acceptance criteria:

Y-column detection uses the selected/manual delimiter and decimal separator.
Metadata-column detection uses metadata-effective params, not the first X file’s parsing.
Repetition-column options come from metadata when metadata exists and parses successfully.
If metadata parsing fails, the UI shows that explicitly instead of silently falling back to Y.
Issue #1 is covered by this behavior.
Persist and execute aggregation/folds correctly
Scope: wizard controls for repetitions and folds must survive submit and affect downstream loading.

Files: index.tsx, TargetsStep.tsx, WizardContext.tsx, datasets.py, nirs4all_adapter.py

Acceptance criteria:

Wizard submit includes aggregation and folds.
Backend translator maps them into valid nirs4all config.
Dataset preview and runs see the same grouping/fold behavior from the stored dataset.
Fold-file detection from folder/file scan is not lost before submit.
Fix task type and default target persistence
Scope: remove stale taskType behavior and preserve the chosen default target during dataset link/load.

Files: TargetsStep.tsx, WizardContext.tsx, index.tsx, workspace.py

Acceptance criteria:

Dataset task_type reflects the user’s selected target types, not stale "auto".
default_target from wizard config survives /datasets/link.
Reloading the dataset detail page shows the same default target the user selected.
Fix browser-mode preview endpoint mismatch
Scope: align frontend web upload preview with an actual backend route.

Files: PreviewStep.tsx, client.ts, datasets.py

Acceptance criteria:

Browser-mode preview no longer calls a nonexistent endpoint.
Upload preview succeeds for local File objects and returns the same response shape as desktop preview.
The preview step can be completed in browser mode without manual backend patching.
Normalize defaults and allowed values
Scope: unify fallback defaults and NA policy vocabulary across frontend and backend.

Files: WizardContext.tsx, workspace.py, workspace_manager.py, spectra.py, settings.ts, datasets.ts

Acceptance criteria:

Default delimiter/header unit/NA policy are identical across wizard, workspace settings, and stored dataset loading.
Backend never emits an NA policy value the frontend cannot represent.
Incomplete legacy dataset configs still load deterministically.
Unify file-ingest entry paths
Scope: folder drop, file drop, manual select, and “add files” should initialize the wizard through equivalent detection logic.

Files: SourceStep.tsx, FileMappingStep.tsx, Datasets.tsx

Acceptance criteria:

The same file set produces the same detected file roles and parsing hints regardless of how it was selected.
Manual file selection is no longer a weaker path than drag/drop.
Clean up dataset page edit panel wiring
Scope: make the dataset detail editor either persist visible controls or remove misleading ones.

Files: EditDatasetPanel.tsx

Acceptance criteria:

Every visible editable field is persisted, or the field is removed/disabled.
Task type and signal type do not present unsupported values.
Editing a dataset cannot silently diverge from the wizard/import config model.
Add regression coverage for dataset import
Scope: add backend and frontend tests around the exact failures found.

Files: tests, likely new backend tests near test_integration_flow.py and new frontend tests under the wizard component test area if present

Acceptance criteria:

Tests cover Y-specific delimiter override across validation, preview, and run-config generation.
Tests cover metadata parsing with different parsing than X.
Tests cover aggregation/folds persistence.
Tests cover default_target preservation after linking.
Tests cover browser-mode preview route.
At least one end-to-end import scenario exercises issues #7 and #1.
Suggested ticket split

P1: tickets 1, 2, 3, 6
P2: tickets 4, 5, 7
P3: tickets 8, 9, 10

