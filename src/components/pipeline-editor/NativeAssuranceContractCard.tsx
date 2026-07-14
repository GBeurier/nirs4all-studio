import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  resolveKeywordRegistryEntry,
  type KeywordRegistryDocument,
  type KeywordRegistryInvalidation,
  type KeywordRegistryStatus,
} from "@/ui/keywordRegistry";

interface NativeAssuranceContractCardProps {
  registry?: KeywordRegistryDocument | null;
  runtimeEngine?: string | null;
}

export type NativeAssuranceDomain = "conformal" | "robustness";

export interface NativeAssuranceKeywordRow {
  domain: NativeAssuranceDomain;
  engineSupport: Record<string, string>;
  invalidatesCalibration: KeywordRegistryInvalidation;
  label: string;
  path: string;
  source: "fallback" | "registry";
  status: KeywordRegistryStatus;
  summary: string;
}

export interface NativeAssuranceContractSummary {
  conformalCount: number;
  requiredRegistryEntryCount: number;
  requiredRegistryEntryLabel: string;
  registrySource: "fallback" | "registry";
  robustnessCount: number;
  runtimeEngineLabel: string;
}

export const REQUIRED_NATIVE_REGISTRY_ENTRY_IDS = [
  "run.tuning",
  "run.tuning.engine",
  "run.tuning.space",
  "run.tuning.force_params",
  "run.tuning.score_data",
  "run.tuning.score_data.conformal_calibration",
  "predict.coverage",
  "predict.all_predictions",
  "robustness.scenarios.kind",
  "robustness.scenarios.severity",
  "robustness.scenarios.distribution",
  "robustness.X",
  "robustness.predictor",
  "robustness.predictor_bundle",
] as const;

const CONFORMAL_KEYWORD_IDS = [
  "run.tuning.space",
  "run.tuning.force_params",
  "run.tuning.calibration",
  "run.tuning.score_data.conformal_calibration",
  "run.tuning.score_data.conformal_coverage",
  "predict.coverage",
  "predict.all_predictions",
  "calibrate.calibration_data",
  "calibrate.calibration_data.dataset",
  "calibrate.calibration_data.y_pred",
] as const;

const ROBUSTNESS_KEYWORD_IDS = [
  "robustness.mode",
  "robustness.scenarios",
  "robustness.scenarios.kind",
  "robustness.scenarios.severity",
  "robustness.scenarios.distribution",
  "robustness.X",
  "robustness.predictor",
  "robustness.predictor_bundle",
  "robustness.slice_by",
  "robustness.workspace_robustness_id",
] as const;

const FALLBACK_NATIVE_ASSURANCE_KEYWORDS: NativeAssuranceKeywordRow[] = [
  {
    domain: "conformal",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "if_predictor_changes",
    label: "Search space",
    path: "run.tuning.space",
    source: "fallback",
    status: "partial",
    summary: "Object/mapping search space for native tuning; changing it can select a different predictor.",
  },
  {
    domain: "conformal",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "if_predictor_changes",
    label: "Forced first trial",
    path: "run.tuning.force_params",
    source: "fallback",
    status: "partial",
    summary: "Optional warm-start parameters for the first tuning trial; keys must exist in run.tuning.space.",
  },
  {
    domain: "conformal",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "replaces_existing",
    label: "Post-tuning calibration",
    path: "run.tuning.calibration",
    source: "fallback",
    status: "partial",
    summary: "Optional final calibration after tuning winner projection; calibration_data is derived from the winner.",
  },
  {
    domain: "conformal",
    engineSupport: { "dag-ml": "partial", legacy: "partial" },
    invalidatesCalibration: "not_applicable",
    label: "Prediction coverage",
    path: "predict.coverage",
    source: "fallback",
    status: "partial",
    summary: "Selects a pre-materialized conformal coverage and fails closed when the bundle has no valid sidecar.",
  },
  {
    domain: "conformal",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "not_applicable",
    label: "Calibration dataset",
    path: "calibrate.calibration_data",
    source: "fallback",
    status: "partial",
    summary: "Explicit row-aligned calibration evidence; Studio must not synthesize sample identities.",
  },
  {
    domain: "conformal",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "not_applicable",
    label: "Dev conformal scoring cohort",
    path: "run.tuning.score_data.conformal_calibration",
    source: "fallback",
    status: "partial",
    summary: "Temporary conformal scoring during tuning; it never replaces the final calibrated result.",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "mode_dependent",
    label: "Robustness scenarios",
    path: "robustness.scenarios",
    source: "fallback",
    status: "partial",
    summary: "Audit-only robustness scenario definitions; diagnostics do not create a new conformal guarantee.",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "mode_dependent",
    label: "Scenario distribution",
    path: "robustness.scenarios.distribution",
    source: "fallback",
    status: "partial",
    summary: "Distribution vocabulary for stochastic robustness scenarios; deterministic scenarios keep it disabled.",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "mode_dependent",
    label: "Robustness X",
    path: "robustness.X",
    source: "fallback",
    status: "partial",
    summary: "Explicit input matrix for spectral robustness scenarios; Studio preserves the key but does not perturb spectra locally.",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "mode_dependent",
    label: "Robustness predictor",
    path: "robustness.predictor",
    source: "fallback",
    status: "partial",
    summary: "In-memory frozen predictor hook for spectral robustness scenarios; Studio preserves the keyword metadata but does not serialize Python objects.",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "mode_dependent",
    label: "Robustness predictor bundle",
    path: "robustness.predictor_bundle",
    source: "fallback",
    status: "partial",
    summary: "Saved predictor path replay hook for explicit-X spectral robustness scenarios; full Python replays it without refit or recalibration.",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "mode_dependent",
    label: "Robustness mode",
    path: "robustness.mode",
    source: "fallback",
    status: "partial",
    summary: "Controls whether perturbations keep the predictor frozen, recalibrate, or refit structurally.",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "not_applicable",
    label: "Diagnostic slices",
    path: "robustness.slice_by",
    source: "fallback",
    status: "partial",
    summary: "Adds diagnostic subgroup views without changing the statistical guarantee scope.",
  },
];

function registryRowsForDomain(
  registry: KeywordRegistryDocument,
  ids: readonly string[],
  domain: NativeAssuranceDomain,
): NativeAssuranceKeywordRow[] {
  return ids
    .map((id) => resolveKeywordRegistryEntry(registry, { id }))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .map((entry) => ({
      domain,
      engineSupport: entry.engine_support,
      invalidatesCalibration: entry.invalidates_calibration,
      label: entry.ui.label,
      path: entry.path,
      source: "registry" as const,
      status: entry.status,
      summary: entry.summary,
    }));
}

function formatEngineSupport(engineSupport: Record<string, string>): string {
  return Object.entries(engineSupport)
    .map(([engine, support]) => `${engine}: ${support}`)
    .join(" · ");
}

export function buildNativeAssuranceKeywordRows(
  registry?: KeywordRegistryDocument | null,
): NativeAssuranceKeywordRow[] {
  if (!registry) return FALLBACK_NATIVE_ASSURANCE_KEYWORDS;

  const rows = [
    ...registryRowsForDomain(registry, CONFORMAL_KEYWORD_IDS, "conformal"),
    ...registryRowsForDomain(registry, ROBUSTNESS_KEYWORD_IDS, "robustness"),
  ];

  return rows.length > 0 ? rows : FALLBACK_NATIVE_ASSURANCE_KEYWORDS;
}

export function buildNativeAssuranceContractSummary(
  rows: readonly NativeAssuranceKeywordRow[],
  runtimeEngine?: string | null,
): NativeAssuranceContractSummary {
  const representedPaths = new Set(rows.map((row) => row.path));
  const representedRequiredEntries = REQUIRED_NATIVE_REGISTRY_ENTRY_IDS
    .filter((id) => representedPaths.has(id));
  return {
    conformalCount: rows.filter((row) => row.domain === "conformal").length,
    requiredRegistryEntryCount: representedRequiredEntries.length,
    requiredRegistryEntryLabel: representedRequiredEntries.length > 0
      ? representedRequiredEntries.join(", ")
      : REQUIRED_NATIVE_REGISTRY_ENTRY_IDS.join(", "),
    registrySource: rows.some((row) => row.source === "registry") ? "registry" : "fallback",
    robustnessCount: rows.filter((row) => row.domain === "robustness").length,
    runtimeEngineLabel: runtimeEngine ? `engine ${runtimeEngine}` : "engine selected at launch",
  };
}

export function NativeAssuranceContractCard({
  registry,
  runtimeEngine,
}: NativeAssuranceContractCardProps) {
  const rows = buildNativeAssuranceKeywordRows(registry);
  const summary = buildNativeAssuranceContractSummary(rows, runtimeEngine);
  const conformalRows = rows.filter((row) => row.domain === "conformal").slice(0, 4);
  const robustnessRows = rows.filter((row) => row.domain === "robustness").slice(0, 4);

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Native assurance contract
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Conformal and robustness keywords for {summary.runtimeEngineLabel}; Studio displays contract effects only.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          registry {summary.registrySource}
        </Badge>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="Conformal fields" value={String(summary.conformalCount)} />
        <Metric label="Robustness fields" value={String(summary.robustnessCount)} />
        <Metric label="Execution" value={summary.runtimeEngineLabel} />
      </div>
      <div className="mb-3 rounded border border-border/50 bg-background/60 px-2 py-1.5 text-[11px]">
        <p className="font-medium text-foreground">
          Required registry floor ({summary.requiredRegistryEntryCount}/{REQUIRED_NATIVE_REGISTRY_ENTRY_IDS.length})
        </p>
        <p className="mt-1 text-muted-foreground">{summary.requiredRegistryEntryLabel}</p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <KeywordSection title="Conformal" rows={conformalRows} />
        <KeywordSection title="Robustness" rows={robustnessRows} />
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Guardrail: Studio does not recalibrate, refit, perturb spectra, or derive guarantees from displayed diagnostics.
      </p>
    </div>
  );
}

function KeywordSection({ title, rows }: { title: string; rows: NativeAssuranceKeywordRow[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-foreground">{title}</p>
      {rows.map((row) => (
        <div key={row.path} className="rounded border border-border/50 bg-background/60 px-2 py-1.5 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{row.path}</code>
            <Badge variant="outline" className="text-[10px]">{row.status}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">{row.summary}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{formatEngineSupport(row.engineSupport)}</p>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/50 bg-background/60 px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <div className="truncate font-medium text-foreground">{value}</div>
    </div>
  );
}
