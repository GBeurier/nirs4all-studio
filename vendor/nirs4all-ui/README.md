# nirs4all-ui

Shared React UI components, visual assets, default styles, brand generators,
and pure TypeScript view-model helpers used by nirs4all Studio, the standalone
web/WASM client, and custom NIRS4ALL app hosts.

This package intentionally keeps components presentational and keeps the
framework-free helpers free of hooks, API clients, filesystem access, browser
globals, or backend/runtime execution. Hosts own app state, routing, data
fetching, and icons; this package owns shared display contracts and reusable
UI surfaces. It also ships the reusable graphical system for the ecosystem:
brand manifests, generated SVG marks, default CSS tokens, and the shared NIR
spectra motion asset.

## Domains

| Domain | Export | What it owns |
| --- | --- | --- |
| `score` | `nirs4all-ui/score` | Metric-key normalization, metric catalog helpers, direction-aware score parsing, comparison, and formatting. |
| `runtime` | `nirs4all-ui/runtime` | Runtime/result status display tokens, busy-state predicates, progress projection, engine metadata summaries, diagnostics, and native-result affordances. |
| `conformal` | `nirs4all-ui/conformal` | Validation and pure view-model projection for native nirs4all `CalibratedRunResult.to_dict()` and `ConformalMetricSet.to_dict()` payloads, guarantee-status badges, calibration replay provenance, coverage options, per-sample prediction interval rows, materialized interval summaries, and empirical metric rows. |
| `robustness` | `nirs4all-ui/robustness` | Validation and compact card view-models for nirs4all robustness `summary.json` artifacts, optional conformal guarantee badge projection, plus fallback and registry-derived mode/scenario/distribution vocabulary and form validation aligned with the Python keyword registry. |
| `keywordRegistry` | `nirs4all-ui/keywordRegistry` | Metadata-only validation, indexing, id/path/token/alias resolution, value-option extraction, form-field projection, ordered form-section grouping, optimizer-persistence field grouping, and workspace prediction publication contract projection for the exported full Python nirs4all keyword/effect registry. |
| `tuning` | `nirs4all-ui/tuning` | Validation and pure view-model projection for native nirs4all `TuningResult.to_dict()` payloads, lightweight `TuningResult.summary_artifact()` / `nirs4all.tuning.summary` cards, and pre-execution `nirs4all.tuning.ordered_search_space` artifacts for Studio/Web forms without optimizer logic. |
| `dataset` | `nirs4all-ui/dataset` | Dataset preview contracts, counts, split summaries, spectral ranges, task labels, badges, and stats. |
| `components` | `nirs4all-ui/components` | Stateless React components that render shared runtime, diagnostic, and metric affordances. |
| `dag` | `nirs4all-ui/dag` | Interactive compiled-DAG explorer (layered layout, pan/zoom, culling/LOD, collapsible clusters) plus the pure engine and a `fromCompiledGraph` adapter for a serialized DAG-ML graph/plan. |
| `chains` | `nirs4all-ui/chains` | Chain-effect explorer over a corpus of scored pipelines: per-node influence ranking, position (early/mid/late) and predecessor×successor order effects, and with/without distribution shift, with per-dataset rank/z normalization. Pure engine + charts + interactive explorer, plus a `parseChainEffectAnalysis` adapter for the serialized `dag-ml` artifact. |
| `lab` | `nirs4all-ui/lab` | Quality/lab decision, sample lifecycle, health, model report, worklist, and budget display contracts plus presentational components. |
| `datasetBuilder` | `nirs4all-ui/datasetBuilder` | Multisource dataset-builder wizard components and pure dataset-config helpers. |
| `brand` | `nirs4all-ui/brand` | Ecosystem brand definitions, stable asset paths, palettes, and deterministic SVG generators. |
| `styles` | `nirs4all-ui/styles` | Default theme tokens, CSS/motion asset manifests, and CSS variable helpers. |
| `assets` | `nirs4all-ui/assets/*` | Package logo kit, ecosystem brand SVGs, default CSS, dataset-builder CSS, quality/lab theme CSS, and animated NIR spectra asset. |

The root export also exposes namespace barrels:

```ts
import { brand, chains, conformal, dag, dataset, datasetBuilder, keywordRegistry, lab, robustness, runtime, score, styles, tuning } from "nirs4all-ui";
```

Prefer domain imports when a consumer only needs one area:

```ts
import { canonicalMetricKey, formatMetricValue } from "nirs4all-ui/score";
import { buildDatasetPreview } from "nirs4all-ui/dataset";
import { buildRuntimeResultStatusView } from "nirs4all-ui/runtime";
import { createConformalGuaranteeView, getCalibrationReplaySource, parseCalibratedRunResultArtifact } from "nirs4all-ui/conformal";
import { createRobustnessGuaranteeView, createRobustnessSummaryCards, getRobustnessSpectralReplay, parseRobustnessSummaryArtifact, validateRobustnessScenarioDraft } from "nirs4all-ui/robustness";
import { createKeywordRegistryFieldViews, createKeywordRegistryWorkspacePredictionPublicationContract, parseKeywordRegistryDocument } from "nirs4all-ui/keywordRegistry";
import { createTuningSearchSpacePreview, createTuningStudySummary, createTuningSummaryCard, createTuningTrialRows, parseOrderedTuningSearchSpaceArtifact, parseTuningResultArtifact, parseTuningSummaryArtifact } from "nirs4all-ui/tuning";
import { DatasetBuilder } from "nirs4all-ui/datasetBuilder";
import { DagGraphView, fromCompiledGraph } from "nirs4all-ui/dag";
import { ChainExplorer, fromScoredChains, parseChainEffectAnalysis } from "nirs4all-ui/chains";
import { DecisionBadge } from "nirs4all-ui/lab";
import { generateNirs4allBrandSvg } from "nirs4all-ui/brand";
import { getNirs4allStyleAsset } from "nirs4all-ui/styles";
import { MetricValueBadge, RuntimeEngineBadge } from "nirs4all-ui/components";
```

The tuning tests include a copied `ordered_search_space_v1.json` fixture from
full Python `nirs4all/tests/fixtures/tuning`. It verifies that this package
continues to parse and project the Python-generated
`nirs4all.tuning.ordered_search_space` contract; update the Python fixture first
when the contract intentionally changes.

Static assets are published through the existing `nirs4all-ui/assets/*` export:

```css
@import "nirs4all-ui/assets/styles/nirs4all-default.css";
@import "nirs4all-ui/assets/datasetBuilder.css";
@import "nirs4all-ui/assets/theme.css";
```

```ts
const css = getNirs4allStyleAsset("default-theme");
const builderCss = getNirs4allStyleAsset("dataset-builder");
const labTheme = getNirs4allStyleAsset("quality-lab-theme");
const animatedIcon = generateNirs4allBrandSvg("nirs4all-ui", {
  variant: "icon",
  animated: true,
});
```

## Development

```bash
npm install
npm run typecheck
npm test
```

`npm run build` emits ESM JavaScript and declaration files under `dist/`.

## GitHub Pages showcase

The single-page component and helper catalogue lives under `site/`.

```bash
npm run site:dev
npm run site:build
```

`site/src/App.tsx` renders reusable React components separately from the
lab, dataset-builder, runtime, score, brand, style, and asset inventories. `site/public/`
intentionally carries the Pages publication files (`logo.svg`, `favicon.ico`,
`favicon.svg`, `robots.txt`, `sitemap.xml`, and `site.webmanifest`). The site
build also copies the package brand kit to namespaced GitHub Pages URLs under
`assets/brand/nirs4all-ui/` and publishes the reusable visual system under
`assets/brands/`, `assets/styles/`, and `assets/motion/`, while package-level
CSS such as `assets/datasetBuilder.css` and `assets/theme.css` remains
available through the npm asset export.
The npm package keeps the same files available through the
`nirs4all-ui/assets/*` export. Production Pages is currently served from the
GitHub project-page path with the default `/nirs4all-ui/` Vite base. When a
dedicated subdomain such as `ui.nirs4all.org` is enabled, switch the Pages
workflow to `NIRS4ALL_UI_BASE=/` and add `site/public/CNAME`.

`site/src/App.test.tsx` is the focused hardening check for the showcase: it
verifies that every public React component, lab, and dataset-builder export
appears in the page and that the mirrored brand/logo, crawler metadata,
manifest, default styles, package CSS assets, motion asset, reusable brand kit,
and canonical URLs stay in sync with the packaged asset set.
