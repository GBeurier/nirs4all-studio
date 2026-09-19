# Local operator qualification

**Latest complete proof: phase 4, 19 September 2026.** The full registry plus five
composed pipelines produced **344 executed successes, 16 explicit Studio context
constraints and ten optional-profile requirements**, in **391.31 seconds**. There
were no failed executions, missing dependencies or timeouts. The strict CPU policy
passed. A readonly audit of the real Results summaries then passed **344/344 cases
and 697 visible model rows**, with finite scores and an evaluated final predictive
output. MLP and native Methods AOM are included in this same unchanged run.

Evidence under `/home/delete/nirs4all-recovery/local-qualification-0.11.9/`:

- `catalog-final-uniform.phase4.json` and its `-cases/` directory: actual execution
  inputs, predictions, stores, logs and explicit policy result.
- `catalog-final-uniform.phase4-results-audit.json`: scores, final-model checks,
  slow cases and matching library/Studio fingerprints across all 344 workers.
- `catalog-final-uniform.phase4-environment.json`: installed packages and verified
  noneditable wheel provenance.

Wheel SHA-256: `a3680b028851fcd2fb2d538a97bc46fc7428557dfa082cb0d166ccd3643255cf`.
Installed RECORD: `2a784884249684ca11aea67dc4dd2f914f62ff4d23ca47a8c45a7fd5c9ee57d1`.
Installed source tree: `8c6efcf810b5fb4096c6fcfd9de0f49381bc61e50ef203fce8502f68c53a72e4`.
The three slowest cases were SequentialFeatureSelector 9.57 s, IntervalPLS 4.75 s
and RepeatedStratifiedKFold 4.06 s. These are measured local Linux timings.

The following earlier phase reports remain historical evidence; the phase 4
report supersedes cumulative counts and the former AOM missing-dependency result.
The ten optional nodes have separate owner-agent execution reports; this CPU
report does not count them as passes. Workers launched with `-I` prove execution,
persistence and Results, not hash-seed-controlled cold TabPFN replay: `-I` ignores
`PYTHONHASHSEED`. That stricter replay has a separate normally launched seed-zero
regression proof. No installer build or publication was performed here.

`scripts/qualify-local-catalog.py` reads the same merged curated/canonical registry as the Studio palette. The current inventory contains 365 entries, rather than a handpicked PLS smoke list. It never installs packages or fetches model weights.

Run it with the Python interpreter from a newly created environment whose exact package profile is recorded:

```bash
/path/to/standard-venv/bin/python scripts/qualify-local-catalog.py \
  --execute --workers 2 --timeout 20 --output /tmp/catalog-cpu.json
```

Omit `--execute` for the inventory. `--node ID` selects a diagnostic subset, with unexecuted entries retained as pending. `--profile tabpfn --node model.tabpfn` permits the optional TabPFN case in a separate environment where its declared dependencies and model weights are already installed. Reports retain interpreter, installed package versions, registry fingerprint, per-case parameters, errors, elapsed time, and process logs. Workers use isolated Python (`-I`), one numerical thread, separate temporary configuration/workspaces and process deadlines.

Each executed node goes through the real editor conversion and Studio training function with generated positive spectra, regression or classification labels, explicit train/test partitions and small folds. Model nodes fit/predict; transform, target-processing, filter, augmentation and splitter nodes execute within a predictive pipeline. Stored prediction arrays must be finite, nonempty and aligned; the actual workspace summary used by Results must contain a model. Registry defaults are retained except declared, recorded caps on computational parameters. No malformed parameter is quietly removed to make a node pass.

Additional composed cases exercise parallel preprocessing branches and merging, target scaling, sequential models, a parameter sweep, a classification pipeline and a deliberately invalid later model. The latter requires earlier successful model scores to remain visible in Results after failure. Its failure is a regression finding, not an expected skip.

Statuses distinguish passed, failed, timeout, missing dependency, required optional profile, required fixture, unsupported Studio context and pending. Any entry without a successful execution prevents `all_nodes_qualified`; an unrestricted execution returns nonzero until the catalog is fully qualified. Focused --node runs have a separate selection result, described below. A missing optional framework does not become proof that its nodes work.

This is a local scientific integration qualification, not a desktop interaction test or an accuracy benchmark. It does not prove arbitrary combinations, dataset-specific metadata/fold-file requirements, every parameter value, GPU behavior, unattended downloads or the quality of trained models. Container/keyword nodes still need individual composed fixtures; the report exposes those gaps instead of claiming complete palette coverage. The existing real Results-page and installed-application smoke tests cover separate rendering and packaging boundaries.

Initial inventory: 337 executable cases including four compositions; 21 entries need contextual fixtures and 11 require a separate optional profile. These counts are inventory facts, not passing results. A preliminary run against the older manual environment stopped on its missing Starlette dependency; the subsequent fresh environment installs requirements-cpu plus the owner wheel. This is the core CPU baseline, not the fuller CPU profile selected through the wizard.

## Fresh core CPU environment: initial evidence

The complete initial CPU pass executed 337 cases: 237 passed and 100 failed; another 21 entries required contextual fixtures and 11 required optional profiles. The unmodified first report is `local-qualification-0.11.9/catalog-cpu.initial.json`. These are raw execution findings, not 100 established product bugs.

Targeted fixture corrections use classifier tags from the actual registry, positive/count features for naive Bayes, enough samples relative to QDA/LassoLars dimensions, category-compatible inputs, real metadata groups, explicit predefined folds, configured nested estimators and interpolation-only samples for default IsotonicRegression. After those separate reruns, 267 cases pass, 70 remain failed, 21 remain without complete contextual fixtures and 11 require an optional profile. This includes three passing complex pipelines; the deliberately invalid later model still exposes lost prior scores against the original frozen wheel. Every rerun preserves the original report and records its own source and environment provenance.

Confirmed product families are distinct from input constraints: modern sklearn target tags not forwarded to supervised transformers; sparse transformed output handling; obsolete/incorrectly typed registry parameter defaults; old IKPLS imports; spectral wavelength warping; split-group information lost after canonical conversion; and persistence after a later pipeline failure. Separate work is correcting those sources; these initial reports do not yet claim their fixes passed in the installed profile.

Some palette entries describe capabilities that cannot be a predictive spectral transform at all. New shared preflight and availability checks explain t-SNE/MDS/SpectralEmbedding's lack of out-of-sample transform, text/dictionary encoders' input requirements, label encoders placed on spectra, and noninvertible target Normalizer/Binarizer. A structural refusal is classified separately from a missing dependency, applies recursively before fitting, and leaves the same operator usable in a valid context. The palette uses metadata-only capability entries with those reasons; it does not quietly label such nodes executable.

### First-install restart contract

`src/components/setup/FirstInstall.restart.test.tsx` mounts both real setup screens
and the real `restartChangedPythonRuntime` helper, controlling only API/IPC and
configuration-query boundaries. Six tests pass: after alignment changed packages,
completion waits for ML readiness, workspace readiness and a cleared restart flag;
a failed new runtime appears in the installation details and cannot complete setup;
unchanged packages do not restart Python. This is a UI contract proof, not a new
installer or network provisioning qualification. The application TypeScript check
also passed after adding these tests.

An explicit `--node` selection now reports `selected_nodes_qualified` separately
from `all_nodes_qualified`. Unselected pending nodes cannot turn a successful
focused rerun into exit 1; missing fixtures in the requested selection still fail,
and unknown IDs stop before worker execution. Four focused tests cover this
reporting boundary. Historical initial reports remain unchanged.

### Full wizard CPU profile

`scripts/qualify-local-wizard.py` creates another Python 3.11+ venv, installs the
core bootstrap and an immutable copy of the candidate wheel, then launches the real
backend with isolated config/workspace directories. It reads `/config/recommended`
and invokes the actual TypeScript optional-selection functions from
`src/lib/setup-config.ts` against the freshly installed packages before calling
`/config/align`. After alignment it restarts the backend, waits for ML/workspace
readiness, runs `pip check` and saves the actual operator availability. This is the
full selected wizard profile proof; the core catalog alone is not equivalent.
The run uses cached package downloads but never clones an existing environment.

### Phase 1 installed-wheel evidence

The corrected noneditable owner wheel has SHA-256
`11a4ad27937929f135e8d298fae007d114c0482d86aca69db5517c7f5992916f`.
`catalog-core.phase1.json` preserves its complete core batch: 323 passed, 17 raw
failures, two then-missing multisource fixtures, 16 explicit unsupported Studio
contexts and 11 optional-profile entries. These are intentionally raw counts.
Subsequent evidence is kept in separate reports:

- `wizard-ci15.phase1.json`: all 15 release-quality scientific cases passed in the
  freshly provisioned real CPU wizard environment.
- `catalog-core.fixture-contexts.phase1.json`: six corrected contexts passed
  (classification labels for default ANOVA selectors, classifier after target
  discretization, and a train-reference Gram matrix for KernelCenterer). The
  MissingIndicator case still exposes a real modern sklearn `allow_nan` tag issue.
- `catalog-core.source-contexts.phase1.json`: two real spectral sources with
  distinct preprocessing and fusion, plus prediction stacking, all passed.
- `wizard-cpu.phase1-py311/qualification.json`: fresh Python 3.11 bootstrap 23.77 s,
  real CPU profile alignment 7.35 s, restart readiness 3.13 s, `pip check` passed.
  Actual preselected extras were the already installed ikpls/pyopls/trendfitter;
  alignment added SHAP/matplotlib. Torch/TabPFN were not selected or installed.
- `wizard-cpu.optin-boosters/qualification.json`: explicit XGBoost/LightGBM
  selection installed versions 3.0.0/4.6.0 through the actual API in 45.20 s;
  restart and `pip check` passed. Library RECORD and install provenance are saved
  before and after mutation. `wizard-optin-boosters.science.json` then passed all
  four regression/classification nodes plus the now-available chart step.

`catalog-phase1.cumulative.json` maps every case to its exact source report. It is
cumulative evidence across these documented environments, not a claim that every
node passed in one unchanged environment. AOM_lib remains absent; deep-learning
and pretrained-model profiles require separate evidence. No publication or
installer rebuild was performed during this local qualification.

### Final bounded qualification after the owner fixes

Phase 2 wheel SHA-256 is
`86edffef93e877cca08620c288f5341c57b9dd7580016043d52240c5cae1f478`.
It was installed noneditable with `--no-deps` into both existing qualification
venvs; their environments were not cloned or rebuilt. All 22 cases in the proposed
scientific CI gate, plus a real pipeline explicitly selecting
`sklearn.feature_selection.f_regression`, passed in the previously provisioned
CPU wizard environment: `wizard-ci22-plus-scorer.phase2.json`, 23/23.

Readonly inspection of the resulting ClassifierChain/MultiOutputClassifier stores
also verified that both truth and predictions retain `(samples, 2)` shapes and
that `n_samples` counts rows, not flattened target values. The evidence is
`multitarget-shapes.phase2.json`. The installed owner declaration rejects the
absent AOM_lib dependency during operator import/preflight, before fitting;
`aomlib-unavailable.phase2.json` records this as unavailable, never as a numerical
success.

The final cumulative map `catalog-final.cumulative.json` contains 370 cases:
365 palette entries and five composed pipelines. It records **342 successful
scientific cases (337 palette entries plus five compositions), 16 explicit Studio
context constraints, 11 separate optional-profile requirements and one absent
AOM_lib dependency**, with no unresolved execution failures. Every positive case
retains its exact source report, interpreter, package inventory and owner/source
hashes. This cumulative map spans phase 1/phase 2 and the documented core/wizard
profiles; it is not a claim that all 370 entries execute in one unchanged package
set, nor that arbitrary combinations or optional frameworks have been qualified.
The optional TabPFN profile has a separate owner-agent qualification.

### Uniform final-wheel sweep and visible-score audit

The complete catalog was subsequently executed again in the **same actual CPU
wizard environment**, with XGBoost 3.0.0 and LightGBM 4.6.0 explicitly installed,
using the phase 2 wheel above. `catalog-final-uniform.phase2.json` preserves the
unchanged report: 370 cases, **342 executed successfully**, 16 explicit Studio
context restrictions, 11 optional classifications, and one failed attempt caused
by the absent external `aompls` module. Elapsed wall time was **393.19 seconds**
with two workers and a strict 30-second per-case limit; there were no timeouts.
The slowest cases were SequentialFeatureSelector (11.09 s), IntervalPLS (4.61 s),
and RepeatedStratifiedKFold (4.08 s). This is local Linux evidence, not a universal
latency promise.

All executed cases had the same installed library RECORD fingerprint
`b746922a6e457b9d1a87740d2e3bbd7eedcd074837fa6625de2bd25ed0321074`
and source-tree fingerprint
`cf196c2f83331ff9031d3a054569e77fa48b56217c992ff05700c58fa689e684`.
The per-case Studio source fingerprints also remained identical throughout this
sweep. `catalog-final-uniform-environment.json` records the package inventory and
noneditable wheel provenance.

A separate readonly pass through the actual Results summary builder verified
**342/342 cases and 693 visible model rows** with genuine finite numerical scores:
`catalog-final-uniform.results-audit-v2.json`. It requires held-out scores for the
final predictive model, preserves legitimate zero scores, rejects missing/NaN
scores and synthetic refit values, and checks that no trained model disappears
from Results. MergePredictions has a scored terminal Ridge model (validation
RMSE 0.07217, test RMSE 0.08420). Its auxiliary `pipeline_stacking_refit_meta`
observation legitimately has only a training score. The audit permits this exact
helper only when a corresponding main final model has held-out scores; it cannot
use a scored intermediate model to hide a missing final score. The earlier audit
report is preserved because it initially rejected this legitimate helper.

Two follow-up findings are kept separate from the immutable sweep. The sklearn
MLP regressor was incorrectly classified as requiring an optional deep-learning
runtime solely because of its UI label; its real execution now passes, including
persisted Results, after fixing that classification and saved-parameter parsing.
The actual required-import boundary now identifies the absent AOM dependency
before fitting, recording `dependency_missing: aompls`, never scientific success.
`catalog-policy-probes.phase2.json` retains both probes. These later corrections
leave **343 executed cases, 16 context restrictions, ten optional profiles and
one unavailable dependency** across the explicitly identified reports, not a
claim that the unchanged uniform report itself had those counts.

The existing quality CI job now runs the entire CPU catalog, followed by the
readonly score audit. `scripts/catalog-cpu-expectations.json` names the exact 26
currently reviewed context/optional limitations. AOM is deliberately not allowed
as a missing dependency: its replacement with the Methods native implementation
must execute successfully; its phase 4 execution and Results audit now pass. A new blocked node, missing expected entry,
wrong missing dependency, failed execution, timeout, unconfigured fixture or
pending case fails the gate. The policy cannot whitelist failed executions and
never marks an accepted limitation scientifically qualified. Optional neural and
pretrained profiles require their own real execution evidence; this CPU gate
alone does not qualify their publication. No extra job matrix or installer
rebuild was introduced by this test change. Thirty-one focused tests protect
the selector, classification, strict policy, numerical score checks and terminal
model rule; actual AOM/MLP probes additionally exercise the import boundary.
