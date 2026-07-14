import { Info, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  createKeywordRegistryOptimizerPersistenceFields,
  resolveKeywordRegistryEntry,
  type KeywordRegistryDocument,
  type KeywordRegistryFieldView,
  type KeywordRegistryInvalidation,
  type KeywordRegistryStatus,
} from "@/ui/keywordRegistry";
import type { FinetuneConfig } from "../types";
import { buildStudioTuningSpacePreview } from "./tuningSpacePreview";

interface FinetuneNativeContractCardProps {
  availableParamCount: number;
  config: FinetuneConfig;
  modelName: string;
  registry?: KeywordRegistryDocument | null;
}

export interface NativeTuningKeywordRow {
  engineSupport: Record<string, string>;
  invalidatesCalibration: KeywordRegistryInvalidation;
  label: string;
  path: string;
  source: "fallback" | "registry";
  status: KeywordRegistryStatus;
  summary: string;
}

export interface NativeTuningEditorSummary {
  enabled: boolean;
  modelName: string;
  nativePayloadLabel: string;
  parameterCount: number;
  readinessLabel: string;
  trialCountLabel: string;
}

const NATIVE_TUNING_KEYWORD_IDS = [
  "run.tuning",
  "run.tuning.engine",
  "run.tuning.space",
  "run.tuning.force_params",
  "run.tuning.n_trials",
  "run.tuning.score_data",
  "run.tuning.calibration",
] as const;

const FALLBACK_NATIVE_TUNING_KEYWORDS: NativeTuningKeywordRow[] = [
  {
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "if_predictor_changes",
    label: "Native tuning block",
    path: "run.tuning",
    source: "fallback",
    status: "partial",
    summary: "Top-level run(tuning=...) payload consumed by the native tuning flow.",
  },
  {
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "if_predictor_changes",
    label: "Search space",
    path: "run.tuning.space",
    source: "fallback",
    status: "partial",
    summary: "Derived from selected tunable parameters; changing it can select a different predictor.",
  },
  {
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "if_predictor_changes",
    label: "Forced first trial",
    path: "run.tuning.force_params",
    source: "fallback",
    status: "partial",
    summary: "Optional public decoded warm-start parameters; keys must exist in run.tuning.space and can change the selected predictor.",
  },
  {
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "if_predictor_changes",
    label: "Trial budget",
    path: "run.tuning.n_trials",
    source: "fallback",
    status: "partial",
    summary: "Controls optimizer effort; Studio records configuration but does not execute trials locally.",
  },
  {
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "not_applicable",
    label: "Score cohort",
    path: "run.tuning.score_data",
    source: "fallback",
    status: "partial",
    summary: "Explicit scoring cohort required at run time; Studio must not infer it from displayed metrics.",
  },
  {
    engineSupport: { "dag-ml": "partial", legacy: "unsupported" },
    invalidatesCalibration: "replaces_existing",
    label: "Final calibration",
    path: "run.tuning.calibration",
    source: "fallback",
    status: "partial",
    summary: "Optional final calibration after winner projection; tuning always happens before calibration.",
  },
  {
    engineSupport: { "dag-ml": "partial", n4m: "unsupported", optuna: "supported" },
    invalidatesCalibration: "not_applicable",
    label: "Optuna storage URI",
    path: "run.tuning.storage",
    source: "fallback",
    status: "partial",
    summary: "Optional optimizer-state storage URI such as sqlite:///study.db; Studio exposes the field but nirs4all owns validation and execution.",
  },
  {
    engineSupport: { "dag-ml": "partial", n4m: "unsupported", optuna: "supported" },
    invalidatesCalibration: "not_applicable",
    label: "Optuna study name",
    path: "run.tuning.study_name",
    source: "fallback",
    status: "partial",
    summary: "Optional storage-backed Optuna study name; Studio transports metadata only and does not resume interrupted optimizers locally.",
  },
];

function formatEngineSupport(engineSupport: Record<string, string>): string {
  return Object.entries(engineSupport)
    .map(([engine, support]) => `${engine}: ${support}`)
    .join(" · ");
}

function keywordFieldToRow(field: KeywordRegistryFieldView): NativeTuningKeywordRow {
  return {
    engineSupport: field.engineSupport,
    invalidatesCalibration: field.invalidatesCalibration,
    label: field.label,
    path: field.path,
    source: "registry",
    status: field.status,
    summary: field.summary,
  };
}

export function buildNativeTuningKeywordRows(
  registry?: KeywordRegistryDocument | null,
): NativeTuningKeywordRow[] {
  if (!registry) return FALLBACK_NATIVE_TUNING_KEYWORDS;

  const baseRows = NATIVE_TUNING_KEYWORD_IDS
    .map((id) => resolveKeywordRegistryEntry(registry, { id }))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .map((entry) => ({
      engineSupport: entry.engine_support,
      invalidatesCalibration: entry.invalidates_calibration,
      label: entry.ui.label,
      path: entry.path,
      source: "registry" as const,
      status: entry.status,
      summary: entry.summary,
    }));
  const optimizerPersistenceRows = createKeywordRegistryOptimizerPersistenceFields(registry)
    .map(keywordFieldToRow);
  const rows = [...baseRows, ...optimizerPersistenceRows];

  return rows.length > 0 ? rows : FALLBACK_NATIVE_TUNING_KEYWORDS;
}

export function buildNativeTuningEditorSummary(
  config: FinetuneConfig,
  modelName: string,
): NativeTuningEditorSummary {
  const parameterCount = (config.model_params?.length ?? 0) + (config.train_params?.length ?? 0);
  return {
    enabled: config.enabled,
    modelName,
    nativePayloadLabel: config.enabled ? "run(tuning=...) candidate" : "No native tuning payload emitted",
    parameterCount,
    readinessLabel: config.enabled
      ? parameterCount > 0
        ? "Ready for native tuning projection"
        : "Needs at least one tunable parameter"
      : "Enable finetuning to prepare a native tuning payload",
    trialCountLabel: config.enabled ? `${config.n_trials} trials` : "disabled",
  };
}

export function FinetuneNativeContractCard({
  availableParamCount,
  config,
  modelName,
  registry,
}: FinetuneNativeContractCardProps) {
  const summary = buildNativeTuningEditorSummary(config, modelName);
  const keywordRows = buildNativeTuningKeywordRows(registry);
  const tuningSpace = buildStudioTuningSpacePreview(config);
  const tuningSpaceRows = tuningSpace.preview?.parameters ?? [];
  const visibleTuningSpaceRows = tuningSpaceRows.slice(0, 5);
  const hiddenTuningSpaceRowCount = Math.max(0, tuningSpaceRows.length - visibleTuningSpaceRows.length);
  const tuningSpaceIssues = tuningSpace.issues.filter((issue) => issue.code !== "finetune_disabled");

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <Workflow className="h-4 w-4 text-purple-500" />
            Native nirs4all tuning contract
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.nativePayloadLabel} for {summary.modelName}; {summary.trialCountLabel}.
          </p>
        </div>
        <Badge variant={summary.enabled ? "default" : "outline"} className="shrink-0 text-[10px]">
          {summary.readinessLabel}
        </Badge>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="Selected params" value={String(summary.parameterCount)} />
        <Metric label="Numeric params" value={String(availableParamCount)} />
        <Metric label="Registry" value={keywordRows.some((row) => row.source === "registry") ? "attached" : "fallback"} />
      </div>

      <div className="mb-3 rounded border border-border/50 bg-background/60 p-2 text-[11px]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h5 className="font-medium text-foreground">Ordered search-space preview</h5>
            <p className="text-muted-foreground">
              `nirs4all.tuning.ordered_search_space` for pre-launch inspection.
            </p>
          </div>
          <Badge variant={tuningSpace.preview ? "secondary" : "outline"} className="text-[10px]">
            {tuningSpace.preview ? tuningSpace.fingerprintKind : "unavailable"}
          </Badge>
        </div>

        {tuningSpace.preview ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Schema" value={`v${tuningSpace.preview.schemaVersion}`} />
              <Metric label="Ordered paths" value={String(tuningSpace.preview.parameterCount)} />
            </div>
            <div className="space-y-1">
              {visibleTuningSpaceRows.map((row) => (
                <div key={row.path} className="rounded bg-muted/50 px-2 py-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">#{row.index}</Badge>
                    <code className="rounded bg-background px-1 py-0.5 font-mono text-[10px]">{row.path}</code>
                    {row.forced && (
                      <Badge variant="secondary" className="text-[10px]">
                        force={row.forcedValueLabel}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate text-muted-foreground">{row.specLabel}</p>
                </div>
              ))}
              {hiddenTuningSpaceRowCount > 0 && (
                <p className="text-muted-foreground">+{hiddenTuningSpaceRowCount} more ordered paths.</p>
              )}
            </div>
            <p className="text-muted-foreground">
              Studio preview fingerprints are display-only; full Python nirs4all owns final TCV1 fingerprints and
              optimizer execution.
            </p>
          </div>
        ) : (
          <div className="space-y-1 text-muted-foreground">
            {config.enabled && tuningSpaceIssues.length > 0 ? (
              tuningSpaceIssues.map((issue) => (
                <p key={`${issue.code}:${issue.path ?? issue.message}`}>{issue.message}</p>
              ))
            ) : (
              <p>Enable finetuning and select at least one model or training parameter to preview ordered paths.</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {keywordRows.map((row) => (
          <div key={row.path} className="rounded border border-border/50 bg-background/60 px-2 py-1.5 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{row.path}</code>
              <Badge variant="outline" className="text-[10px]">{row.status}</Badge>
              <span className="text-muted-foreground">{formatEngineSupport(row.engineSupport)}</span>
            </div>
            <p className="mt-1 text-muted-foreground">{row.summary}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Studio prepares the configuration only. The optimizer runs in nirs4all, and final conformal calibration is
          attached after the winner is selected.
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/50 bg-background/60 px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <div className="font-medium text-foreground">{value}</div>
    </div>
  );
}
