import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { getLinkedWorkspaces } from "@/api/linkedWorkspaces";
import { getAvailableModels, runPrediction, runPredictionWithFile } from "@/api/predict";
import { formatApiErrorDetail } from "@/api/transport";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AvailableModel, PredictResponse } from "@/types/predict";
import { DataInput, type DataSourceConfig } from "./DataInput";
import { PredictResults, type PredictionInput } from "./PredictResults";

function modelKey(model: AvailableModel) {
  return `${model.source}:${model.id}:${model.archive_fingerprint ?? model.artifact_fingerprint ?? ""}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "detail" in error) return formatApiErrorDetail(error.detail);
  return "The general prediction service is unavailable.";
}

function inputDescription(input: DataSourceConfig): PredictionInput {
  if (input.type === "file") return { type: "file", fileName: input.file.name };
  if (input.type === "array") return { type: "array", rowCount: input.spectra.length };
  return input;
}

/** General fitted host models remain visibly distinct from portable archives. */
export function GeneralPredictionPanel() {
  const workspaces = useQuery({ queryKey: ["linked-workspaces", "general-prediction"], queryFn: getLinkedWorkspaces });
  const workspaceId = workspaces.data?.active_workspace_id ?? null;
  const catalogue = useQuery({ queryKey: ["general-prediction-models", workspaceId], queryFn: getAvailableModels, enabled: workspaceId !== null });
  const [selection, setSelection] = useState<{ workspaceId: string; key: string } | null>(null);
  const model = selection?.workspaceId === workspaceId ? catalogue.data?.models.find((item) => modelKey(item) === selection.key) ?? null : null;
  const [outputIndex, setOutputIndex] = useState(0);
  const [fileHeader, setFileHeader] = useState("yes");
  const [outcome, setOutcome] = useState<{ workspaceId: string; key: string; response: PredictResponse; input: PredictionInput } | null>(null);
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
          <h1 className="text-2xl font-bold">Predict with trained models</h1>
          <p className="text-sm text-muted-foreground">Replay a captured full-training model through DAG-ML, without retraining. These Python host models are not portable Archive V2 files.</p>
        </div>
        <Card>
          <CardHeader><CardTitle>Trained model</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {workspaces.isPending || (workspaceId && catalogue.isPending) ? <p role="status">Loading model catalogue…</p> : null}
            {!workspaces.isPending && !workspaceId && <p>Select a workspace before predicting.</p>}
            {catalogue.data?.total === 0 && <p>No captured general model is available. Train and save a model in this workspace first.</p>}
            <label className="block text-sm" htmlFor="general-model">Model</label>
            <select id="general-model" className="w-full rounded-md border bg-background p-2" value={model ? modelKey(model) : ""}
              disabled={!workspaceId || prediction.isPending} onChange={(event) => {
                setSelection(workspaceId ? { workspaceId, key: event.target.value } : null);
                setOutcome(null); setOutputIndex(0); prediction.reset();
              }}>
              <option value="">Choose a trained model</option>
              {catalogue.data?.models.map((item) => <option key={modelKey(item)} value={modelKey(item)}>{item.name} · {item.dataset_name ?? item.source} · {item.id}</option>)}
            </select>
            {(model?.target_names?.length ?? 0) > 1 && <label className="block text-sm">Displayed target
              <select aria-label="Displayed target" className="ml-3 rounded-md border bg-background p-2" value={outputIndex} disabled={prediction.isPending}
                onChange={(event) => { setOutputIndex(Number(event.target.value)); setOutcome(null); }}>
                {model!.target_names!.map((name, index) => <option key={name} value={index}>{name}</option>)}
              </select>
            </label>}
            <Button variant="outline" disabled={catalogue.isFetching || !workspaceId} onClick={() => void catalogue.refetch()}>Refresh models</Button>
          </CardContent>
        </Card>
        {error && <p role="alert" className="text-sm text-destructive">{errorMessage(error)}</p>}
        <label className="block text-sm">Uploaded file header
          <select aria-label="Uploaded file header" className="ml-3 rounded-md border bg-background p-2" value={fileHeader}
            disabled={prediction.isPending} onChange={(event) => setFileHeader(event.target.value)}>
            <option value="yes">First row contains column names</option>
            <option value="no">No header — first row is a sample</option>
            <option value="auto">Auto-detect (numeric headers can be ambiguous)</option>
          </select>
        </label>
        <DataInput model={model} isLoading={prediction.isPending} onRunPrediction={(input) => {
          if (model && workspaceId) prediction.mutate({ selected: model, input, workspace: workspaceId, target: outputIndex });
        }} />
        {result && <>
          <p role="status">{result.response.num_samples} predictions · displayed target: {result.response.target_names?.[result.response.output_index ?? 0] ?? "y"} · captured REFIT, no training.</p>
          <PredictResults result={result.response} model={model} input={result.input} onReset={() => { setOutcome(null); prediction.reset(); }} />
          {((result.response.target_names?.length ?? 0) > 1 || result.response.sample_labels) && <div className="overflow-auto rounded-md border">
            <table className="w-full text-left text-sm"><caption>Predictions for every target, in original target units</caption>
              <thead><tr><th>Execution sample ID</th>{result.response.sample_labels && <th>Uploaded sample label</th>}{result.response.target_names!.map((name) => <th key={name}>{name}</th>)}</tr></thead>
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
