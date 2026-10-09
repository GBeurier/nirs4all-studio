import { Info, Workflow } from "lucide-react";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
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

interface FallbackKeywordSpec {
  engineSupport: Record<string, string>;
  i18nKey: string;
  invalidatesCalibration: KeywordRegistryInvalidation;
  path: string;
}

const DAG_PARTIAL = { "dag-ml": "partial", legacy: "unsupported" };
const OPTUNA_SUPPORTED = { "dag-ml": "partial", n4m: "unsupported", optuna: "supported" };

const FALLBACK_NATIVE_TUNING_KEYWORD_SPECS: FallbackKeywordSpec[] = [
  { engineSupport: DAG_PARTIAL, i18nKey: "tuning", invalidatesCalibration: "if_predictor_changes", path: "run.tuning" },
  { engineSupport: DAG_PARTIAL, i18nKey: "space", invalidatesCalibration: "if_predictor_changes", path: "run.tuning.space" },
  { engineSupport: DAG_PARTIAL, i18nKey: "forceParams", invalidatesCalibration: "if_predictor_changes", path: "run.tuning.force_params" },
  { engineSupport: DAG_PARTIAL, i18nKey: "nTrials", invalidatesCalibration: "if_predictor_changes", path: "run.tuning.n_trials" },
  { engineSupport: DAG_PARTIAL, i18nKey: "scoreData", invalidatesCalibration: "not_applicable", path: "run.tuning.score_data" },
  { engineSupport: DAG_PARTIAL, i18nKey: "calibration", invalidatesCalibration: "replaces_existing", path: "run.tuning.calibration" },
  { engineSupport: OPTUNA_SUPPORTED, i18nKey: "storage", invalidatesCalibration: "not_applicable", path: "run.tuning.storage" },
  { engineSupport: OPTUNA_SUPPORTED, i18nKey: "studyName", invalidatesCalibration: "not_applicable", path: "run.tuning.study_name" },
];

/** Built at call time so labels follow the active UI language. */
function buildFallbackNativeTuningKeywords(): NativeTuningKeywordRow[] {
  return FALLBACK_NATIVE_TUNING_KEYWORD_SPECS.map((spec) => ({
    engineSupport: spec.engineSupport,
    invalidatesCalibration: spec.invalidatesCalibration,
    label: i18n.t(`pipelineEditor.finetune.fallbackRows.${spec.i18nKey}.label`),
    path: spec.path,
    source: "fallback" as const,
    status: "partial" as const,
    summary: i18n.t(`pipelineEditor.finetune.fallbackRows.${spec.i18nKey}.summary`),
  }));
}

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
  if (!registry) return buildFallbackNativeTuningKeywords();

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

  return rows.length > 0 ? rows : buildFallbackNativeTuningKeywords();
}

export function buildNativeTuningEditorSummary(
  config: FinetuneConfig,
  modelName: string,
): NativeTuningEditorSummary {
  const parameterCount = (config.model_params?.length ?? 0) + (config.train_params?.length ?? 0);
  return {
    enabled: config.enabled,
    modelName,
    nativePayloadLabel: config.enabled
      ? i18n.t("pipelineEditor.finetune.card.payloadCandidate")
      : i18n.t("pipelineEditor.finetune.card.payloadNone"),
    parameterCount,
    readinessLabel: config.enabled
      ? parameterCount > 0
        ? i18n.t("pipelineEditor.finetune.card.ready")
        : i18n.t("pipelineEditor.finetune.card.needsParam")
      : i18n.t("pipelineEditor.finetune.card.enableToPrepare"),
    trialCountLabel: config.enabled
      ? i18n.t("pipelineEditor.finetune.trialCount", { count: config.n_trials })
      : i18n.t("pipelineEditor.finetune.card.disabled"),
  };
}

export function FinetuneNativeContractCard({
  availableParamCount,
  config,
  modelName,
  registry,
}: FinetuneNativeContractCardProps) {
  const { t } = useTranslation();
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
            {t("pipelineEditor.finetune.card.title")}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("pipelineEditor.finetune.card.payloadFor", { payload: summary.nativePayloadLabel, model: summary.modelName, trials: summary.trialCountLabel })}
          </p>
        </div>
        <Badge variant={summary.enabled ? "default" : "outline"} className="shrink-0 text-[10px]">
          {summary.readinessLabel}
        </Badge>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
        <Metric label={t("pipelineEditor.finetune.card.selectedParams")} value={String(summary.parameterCount)} />
        <Metric label={t("pipelineEditor.finetune.card.numericParams")} value={String(availableParamCount)} />
        <Metric label={t("pipelineEditor.finetune.card.registry")} value={keywordRows.some((row) => row.source === "registry") ? t("pipelineEditor.finetune.card.registryAttached") : t("pipelineEditor.finetune.card.registryFallback")} />
      </div>

      <div className="mb-3 rounded border border-border/50 bg-background/60 p-2 text-[11px]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h5 className="font-medium text-foreground">{t("pipelineEditor.finetune.card.previewTitle")}</h5>
            <p className="text-muted-foreground">
              {t("pipelineEditor.finetune.card.previewDescription")}
            </p>
          </div>
          <Badge variant={tuningSpace.preview ? "secondary" : "outline"} className="text-[10px]">
            {tuningSpace.preview ? tuningSpace.fingerprintKind : t("pipelineEditor.finetune.card.previewUnavailable")}
          </Badge>
        </div>

        {tuningSpace.preview ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Metric label={t("pipelineEditor.finetune.card.schema")} value={`v${tuningSpace.preview.schemaVersion}`} />
              <Metric label={t("pipelineEditor.finetune.card.orderedPaths")} value={String(tuningSpace.preview.parameterCount)} />
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
                <p className="text-muted-foreground">{t("pipelineEditor.finetune.card.morePaths", { count: hiddenTuningSpaceRowCount })}</p>
              )}
            </div>
            <p className="text-muted-foreground">
              {t("pipelineEditor.finetune.card.fingerprintNote")}
            </p>
          </div>
        ) : (
          <div className="space-y-1 text-muted-foreground">
            {config.enabled && tuningSpaceIssues.length > 0 ? (
              tuningSpaceIssues.map((issue) => (
                <p key={`${issue.code}:${issue.path ?? issue.message}`}>{issue.message}</p>
              ))
            ) : (
              <p>{t("pipelineEditor.finetune.card.enableToPreview")}</p>
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
          {t("pipelineEditor.finetune.card.footer")}
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
