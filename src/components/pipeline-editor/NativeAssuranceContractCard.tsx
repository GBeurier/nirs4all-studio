import { useTranslation } from "react-i18next";
import i18n from "i18next";
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

type FallbackKeywordDefinition = Omit<NativeAssuranceKeywordRow, "label" | "source" | "summary"> & {
  /** Id under `pipelineEditor.assurance.fallback` holding the localized label and summary. */
  id: string;
};

const FALLBACK_NATIVE_ASSURANCE_KEYWORDS: FallbackKeywordDefinition[] = [
  {
    domain: "conformal",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    id: "searchSpace",
    invalidatesCalibration: "if_predictor_changes",
    path: "run.tuning.space",
    status: "partial",
  },
  {
    domain: "conformal",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    id: "forcedFirstTrial",
    invalidatesCalibration: "if_predictor_changes",
    path: "run.tuning.force_params",
    status: "partial",
  },
  {
    domain: "conformal",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    id: "postTuningCalibration",
    invalidatesCalibration: "replaces_existing",
    path: "run.tuning.calibration",
    status: "partial",
  },
  {
    domain: "conformal",
    engineSupport: { "dag-ml": "partial", legacy: "partial" },
    id: "predictionCoverage",
    invalidatesCalibration: "not_applicable",
    path: "predict.coverage",
    status: "partial",
  },
  {
    domain: "conformal",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    id: "calibrationDataset",
    invalidatesCalibration: "not_applicable",
    path: "calibrate.calibration_data",
    status: "partial",
  },
  {
    domain: "conformal",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    id: "devConformalScoring",
    invalidatesCalibration: "not_applicable",
    path: "run.tuning.score_data.conformal_calibration",
    status: "partial",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    id: "robustnessScenarios",
    invalidatesCalibration: "mode_dependent",
    path: "robustness.scenarios",
    status: "partial",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    id: "scenarioDistribution",
    invalidatesCalibration: "mode_dependent",
    path: "robustness.scenarios.distribution",
    status: "partial",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    id: "robustnessX",
    invalidatesCalibration: "mode_dependent",
    path: "robustness.X",
    status: "partial",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    id: "robustnessPredictor",
    invalidatesCalibration: "mode_dependent",
    path: "robustness.predictor",
    status: "partial",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    id: "robustnessPredictorBundle",
    invalidatesCalibration: "mode_dependent",
    path: "robustness.predictor_bundle",
    status: "partial",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    id: "robustnessMode",
    invalidatesCalibration: "mode_dependent",
    path: "robustness.mode",
    status: "partial",
  },
  {
    domain: "robustness",
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    id: "diagnosticSlices",
    invalidatesCalibration: "not_applicable",
    path: "robustness.slice_by",
    status: "partial",
  },
];

/** Resolve the fallback keyword rows at call time so labels follow the active language. */
function buildFallbackKeywordRows(): NativeAssuranceKeywordRow[] {
  return FALLBACK_NATIVE_ASSURANCE_KEYWORDS.map(({ id, ...row }) => ({
    ...row,
    label: i18n.t(`pipelineEditor.assurance.fallback.${id}.label`),
    source: "fallback" as const,
    summary: i18n.t(`pipelineEditor.assurance.fallback.${id}.summary`),
  }));
}

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
  if (!registry) return buildFallbackKeywordRows();

  const rows = [
    ...registryRowsForDomain(registry, CONFORMAL_KEYWORD_IDS, "conformal"),
    ...registryRowsForDomain(registry, ROBUSTNESS_KEYWORD_IDS, "robustness"),
  ];

  return rows.length > 0 ? rows : buildFallbackKeywordRows();
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
    runtimeEngineLabel: runtimeEngine
      ? i18n.t("pipelineEditor.assurance.engineLabel", { engine: runtimeEngine })
      : i18n.t("pipelineEditor.assurance.engineAtLaunch"),
  };
}

export function NativeAssuranceContractCard({
  registry,
  runtimeEngine,
}: NativeAssuranceContractCardProps) {
  const { t } = useTranslation();
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
            {t("pipelineEditor.assurance.title")}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("pipelineEditor.assurance.subtitle", { engine: summary.runtimeEngineLabel })}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {t("pipelineEditor.assurance.registryBadge", { source: t(`pipelineEditor.assurance.registrySource.${summary.registrySource}`) })}
        </Badge>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
        <Metric label={t("pipelineEditor.assurance.conformalFields")} value={String(summary.conformalCount)} />
        <Metric label={t("pipelineEditor.assurance.robustnessFields")} value={String(summary.robustnessCount)} />
        <Metric label={t("pipelineEditor.assurance.execution")} value={summary.runtimeEngineLabel} />
      </div>
      <div className="mb-3 rounded border border-border/50 bg-background/60 px-2 py-1.5 text-[11px]">
        <p className="font-medium text-foreground">
          {t("pipelineEditor.assurance.requiredFloor", { count: summary.requiredRegistryEntryCount, total: REQUIRED_NATIVE_REGISTRY_ENTRY_IDS.length })}
        </p>
        <p className="mt-1 text-muted-foreground">{summary.requiredRegistryEntryLabel}</p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <KeywordSection title={t("pipelineEditor.assurance.conformal")} rows={conformalRows} />
        <KeywordSection title={t("pipelineEditor.assurance.robustness")} rows={robustnessRows} />
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        {t("pipelineEditor.assurance.guardrail")}
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
