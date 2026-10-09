import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";

import { getLinkedWorkspaces } from "@/api/linkedWorkspaces";
import { getAvailableModels, runPrediction, runPredictionWithFile } from "@/api/predict";
import { formatApiErrorDetail } from "@/api/transport";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AvailableModel, PredictResponse, PredictionValue } from "@/types/predict";
import { DataInput, type DataSourceConfig } from "./DataInput";
import { PredictResults, type PredictionInput } from "./PredictResults";

function modelKey(model: AvailableModel) {
  return `${model.source}:${model.id}:${model.archive_fingerprint ?? model.artifact_fingerprint ?? ""}`;
}

function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "detail" in error) return formatApiErrorDetail(error.detail);
  return t("predict.general.unavailable");
}

function inputDescription(input: DataSourceConfig): PredictionInput {
  if (input.type === "file") return { type: "file", fileName: input.file.name };
  if (input.type === "array") return { type: "array", rowCount: input.spectra.length };
  return input;
}

/** General fitted host models remain visibly distinct from portable archives. */
export function GeneralPredictionPanel() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const workspaces = useQuery({ queryKey: ["linked-workspaces", "general-prediction"], queryFn: getLinkedWorkspaces });
  const workspaceId = workspaces.data?.active_workspace_id ?? null;
  const catalogue = useQuery({ queryKey: ["general-prediction-models", workspaceId], queryFn: getAvailableModels, enabled: workspaceId !== null });
  const [selection, setSelection] = useState<{ workspaceId: string; key: string } | null>(null);
  const model = selection?.workspaceId === workspaceId
    ? catalogue.data?.models.find((item) => modelKey(item) === selection.key) ?? null
    : selection === null
      ? catalogue.data?.models.find((item) => item.id === searchParams.get("model_id")
        && item.source === searchParams.get("source")) ?? null
      : null;
  const [outputIndex, setOutputIndex] = useState(0);
  const [fileHeader, setFileHeader] = useState("yes");
  const [outcome, setOutcome] = useState<{ workspaceId: string; key: string; response: PredictResponse<PredictionValue>; input: PredictionInput } | null>(null);
  const prediction = useMutation({
    mutationFn: async ({ selected, input, workspace, target }: { selected: AvailableModel; input: DataSourceConfig; workspace: string; target: number }) => {
      const options = { archive_fingerprint: selected.archive_fingerprint, output_index: target };
      const response = input.type === "file"
        ? await runPredictionWithFile(selected.id, selected.source, input.file, { ...options,
          ...(fileHeader === "auto" ? {} : { has_header: fileHeader === "yes" }) })
        : await runPrediction({ model_id: selected.id, model_source: selected.source, ...options,
          ...(input.type === "array" ? { data_source: "array", spectra: input.spectra } as const
            : { data_source: "dataset", dataset_id: input.datasetId, partition: input.partition } as const) });
      return { workspaceId: workspace, key: modelKey(selected), response, input: inputDescription(input) };
    },
    onSuccess: setOutcome,
  });
  const result = outcome?.workspaceId === workspaceId && model && outcome.key === modelKey(model) ? outcome : null;
  const error = workspaces.error || catalogue.error || prediction.error;

  return (
    <MlLoadingOverlay>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold">{t("predict.general.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("predict.general.description")}</p>
        </div>
        <Card>
          <CardHeader><CardTitle>{t("predict.general.trainedModel")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {workspaces.isPending || (workspaceId && catalogue.isPending) ? <p role="status">{t("predict.general.loadingCatalogue")}</p> : null}
            {!workspaces.isPending && !workspaceId && <p>{t("predict.general.selectWorkspace")}</p>}
            {catalogue.data?.total === 0 && <p>{t("predict.general.noModels")}</p>}
            <label className="block text-sm" htmlFor="general-model">{t("predict.general.modelLabel")}</label>
            <select id="general-model" className="w-full rounded-md border bg-background p-2" value={model ? modelKey(model) : ""}
              disabled={!workspaceId || prediction.isPending} onChange={(event) => {
                setSelection(workspaceId ? { workspaceId, key: event.target.value } : null);
                setOutcome(null); setOutputIndex(0); prediction.reset();
              }}>
              <option value="">{t("predict.general.choosePlaceholder")}</option>
              {catalogue.data?.models.map((item) => <option key={modelKey(item)} value={modelKey(item)}>{item.name} · {item.dataset_name ?? item.source} · {item.id}{item.input_kind === "multimodal" ? ` · ${t("predict.general.multimodal")}` : ""}</option>)}
            </select>
            {(model?.target_names?.length ?? 0) > 1 && <label className="block text-sm">{t("predict.general.displayedTarget")}
              <select aria-label={t("predict.general.displayedTarget")} className="ml-3 rounded-md border bg-background p-2" value={outputIndex} disabled={prediction.isPending}
                onChange={(event) => { setOutputIndex(Number(event.target.value)); setOutcome(null); }}>
                {model!.target_names!.map((name, index) => <option key={name} value={index}>{name}</option>)}
              </select>
            </label>}
            <Button variant="outline" disabled={catalogue.isFetching || !workspaceId} onClick={() => void catalogue.refetch()}>{t("predict.general.refreshModels")}</Button>
          </CardContent>
        </Card>
        {error && <p role="alert" className="text-sm text-destructive">{errorMessage(error, t)}</p>}
        {model?.input_kind !== "multimodal" && <label className="block text-sm">{t("predict.general.fileHeader")}
          <select aria-label={t("predict.general.fileHeader")} className="ml-3 rounded-md border bg-background p-2" value={fileHeader}
            disabled={prediction.isPending} onChange={(event) => setFileHeader(event.target.value)}>
            <option value="yes">{t("predict.general.headerYes")}</option>
            <option value="no">{t("predict.general.headerNo")}</option>
            <option value="auto">{t("predict.general.headerAuto")}</option>
          </select>
        </label>}
        <DataInput model={model} isLoading={prediction.isPending} onRunPrediction={(input) => {
          if (model && workspaceId) prediction.mutate({ selected: model, input, workspace: workspaceId, target: outputIndex });
        }} />
        {result && <>
          <p role="status">{t("predict.general.resultStatus", { count: result.response.num_samples, target: result.response.target_names?.[result.response.output_index ?? 0] ?? "y" })}</p>
          <PredictResults result={result.response} model={model} input={result.input} onReset={() => { setOutcome(null); prediction.reset(); }} />
          {((result.response.target_names?.length ?? 0) > 1 || result.response.sample_labels) && <div className="overflow-auto rounded-md border">
            <table className="w-full text-left text-sm"><caption>{t("predict.general.tableCaption")}</caption>
              <thead><tr><th>{t("predict.general.colSampleId")}</th>{result.response.sample_labels && <th>{t("predict.general.colSampleLabel")}</th>}{result.response.target_names!.map((name) => <th key={name}>{name}</th>)}</tr></thead>
              <tbody>{result.response.prediction_matrix?.map((row, index) => <tr key={String(result.response.sample_ids?.[index] ?? index)}>
                <td>{result.response.sample_ids?.[index] ?? index}</td>{result.response.sample_labels && <td>{result.response.sample_labels[index]}</td>}{row.map((value, target) => <td key={target}>{value}</td>)}
              </tr>)}</tbody>
            </table>
          </div>}
        </>}
      </div>
    </MlLoadingOverlay>
  );
}
