import type { TFunction } from "i18next";
import type { PartitionPrediction } from "@/types/aggregated-predictions";

export type ModelActionDeleteScope = "chain" | "group";
export type ModelActionArtifactHandling = "cleanup-orphans" | "preserve-shared";
export type ModelActionPredictSource = "chain" | "bundle";

export interface ModelActionPredictRef {
  id: string;
  source: ModelActionPredictSource;
}

export interface ModelActionLinkInput {
  chainId: string;
  predictChainId?: string;
  predictModel?: ModelActionPredictRef | null;
  datasetName?: string;
  hasRefit: boolean;
}

export interface ModelActionLinks {
  datasetUrl: string | null;
  pipelineEditorUrl: string | null;
  predictUrl: string | null;
}

export interface ModelActionDeleteInput {
  chainId: string;
  deleteScope?: ModelActionDeleteScope;
  foldId?: string;
  modelName: string;
  workspaceId?: string;
}

export interface ModelActionDeleteDescriptor {
  artifactHandling: ModelActionArtifactHandling;
  canDelete: boolean;
  description: string;
  label: string;
  title: string;
}

const MODEL_ACTION_ARTIFACT_HANDLING: Record<ModelActionDeleteScope, ModelActionArtifactHandling> = {
  chain: "preserve-shared",
  group: "cleanup-orphans",
};

function resolveModelActionDeleteScope(deleteScope?: ModelActionDeleteScope): ModelActionDeleteScope {
  return deleteScope === "group" ? "group" : "chain";
}

export const MODEL_ACTION_CSV_COLUMNS = [
  "fold_id",
  "partition",
  "model_name",
  "dataset_name",
  "val_score",
  "test_score",
  "train_score",
  "metric",
  "n_samples",
  "preprocessings",
] as const;

type ModelActionCsvColumn = typeof MODEL_ACTION_CSV_COLUMNS[number];

export function buildModelActionLinks({
  chainId,
  predictChainId,
  predictModel,
  datasetName,
  hasRefit,
}: ModelActionLinkInput): ModelActionLinks {
  const effectivePredictModel = predictModel ?? (
    predictChainId || chainId
      ? { id: predictChainId || chainId, source: "chain" as const }
      : null
  );
  return {
    datasetUrl: datasetName ? `/datasets/${encodeURIComponent(datasetName)}` : null,
    pipelineEditorUrl: chainId ? `/pipelines/new?chainId=${encodeURIComponent(chainId)}` : null,
    predictUrl: hasRefit && effectivePredictModel
      ? `/predict?model_id=${encodeURIComponent(effectivePredictModel.id)}&source=${effectivePredictModel.source}`
      : null,
  };
}

export function buildModelActionDeleteDescriptor({
  chainId,
  deleteScope,
  foldId,
  modelName,
  workspaceId,
}: ModelActionDeleteInput, t: TFunction): ModelActionDeleteDescriptor {
  const resolvedScope = resolveModelActionDeleteScope(deleteScope);
  return {
    artifactHandling: MODEL_ACTION_ARTIFACT_HANDLING[resolvedScope],
    canDelete: Boolean(
      workspaceId
      && chainId
      && (deleteScope === "chain" || (deleteScope === "group" && foldId)),
    ),
    description: resolvedScope === "chain"
      ? t("results.scores.delete.chain.description", { modelName })
      : t("results.scores.delete.group.description", { group: foldId || t("results.scores.delete.selectedGroup"), modelName }),
    label: t(`results.scores.delete.${resolvedScope}.label`),
    title: t(`results.scores.delete.${resolvedScope}.title`),
  };
}

export function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildModelActionCsv(rows: PartitionPrediction[]): string {
  const lines = rows.map((row) => MODEL_ACTION_CSV_COLUMNS
    .map((column) => csvEscape(row[column as ModelActionCsvColumn]))
    .join(","));
  return [MODEL_ACTION_CSV_COLUMNS.join(","), ...lines].join("\n");
}

export function sanitizeModelActionFilenamePart(value: string | null | undefined): string {
  return (value || "chain").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function buildModelActionCsvFilename(modelName: string, chainId: string): string {
  return `${sanitizeModelActionFilenamePart(modelName)}_${sanitizeModelActionFilenamePart(chainId.slice(0, 8))}.csv`;
}
