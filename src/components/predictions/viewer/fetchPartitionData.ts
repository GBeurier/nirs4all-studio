/**
 * Parallel fetching of prediction arrays for a set of ViewerPartitionTargets.
 *
 * Supports both the aggregated-predictions endpoint and the
 * workspace-scoped scatter endpoint via the target's `source` discriminator.
 */

import { useEffect, useMemo, useState } from "react";
import { getN4AWorkspacePredictionScatter } from "@/api/linkedWorkspaces";
import { getPredictionArrays } from "@/api/aggregatedPredictions";
import type { PredictionArrayPayload } from "@/types/aggregated-predictions";
import { attachConformalIntervalsToSingleDataset } from "./conformalChartData";
import type { PartitionDataset, ViewerPartitionTarget } from "./types";
import { coercePredictionVector, predictionOutputCount } from "./predictionOutputs";
export { coercePredictionVector } from "./predictionOutputs";

interface Options {
  partitions: ViewerPartitionTarget[];
  workspaceId?: string;
  /** If false, skip fetching (e.g. viewer not open). */
  enabled?: boolean;
}

interface FetchedPartition extends PartitionDataset {
  rawYTrue: PredictionArrayPayload;
  rawYPred: PredictionArrayPayload;
}

interface State {
  data: FetchedPartition[];
  isLoading: boolean;
  error: string | null;
}

async function fetchOne(
  target: ViewerPartitionTarget,
  workspaceId: string | undefined,
): Promise<FetchedPartition> {
  if (target.source === "workspace" && !workspaceId) {
    throw new Error("workspaceId is required for workspace-source predictions");
  }
  const response = target.source === "workspace"
    ? await getN4AWorkspacePredictionScatter(workspaceId!, target.predictionId)
    : await getPredictionArrays(target.predictionId);
  const rawYTrue = response.y_true ?? [];
  const rawYPred = response.y_pred ?? [];
  const trueOutputs = predictionOutputCount(rawYTrue);
  const outputCount = predictionOutputCount(rawYPred);
  if (rawYTrue.length && (rawYTrue.length !== rawYPred.length || trueOutputs !== outputCount)) {
    throw new Error("Actual and predicted arrays have different sample/output shapes");
  }
  if (response.sample_ids && response.sample_ids.length !== rawYPred.length) {
    throw new Error("Prediction sample identities do not match the array rows");
  }
  const dataset: FetchedPartition = {
    predictionId: target.predictionId,
    partition: target.partition,
    label: target.label ?? target.partition,
    rawYTrue, rawYPred,
    yTrue: coercePredictionVector(rawYTrue),
    yPred: coercePredictionVector(rawYPred),
    outputCount, outputIndex: 0,
    nSamples: rawYPred.length,
    sampleIds: response.sample_ids ?? undefined,
    sampleMetadata: response.sample_metadata ?? null,
  };
  // Existing conformal rows describe a scalar output; never assign them to
  // another target without an explicit target identity in that evidence.
  if (outputCount <= 1 && target.conformalRows?.length) {
    return { ...dataset, ...attachConformalIntervalsToSingleDataset(
      [dataset], target.conformalRows, target.conformalCoverage,
    )[0] };
  }
  return dataset;
}

/** Fetches all partitions in parallel; returns the combined state. */
export function usePartitionsData({ partitions, workspaceId, enabled = true }: Options) {
  const [state, setState] = useState<State>({ data: [], isLoading: false, error: null });
  const [selectedOutput, setOutputIndex] = useState(0);
  // Stable signature: include conformal coverage/rows because those decorate the
  // resolved dataset used by full-screen charts and CSV exports.
  const signature = partitions
    .map((p) => `${p.source}:${p.predictionId}:${p.conformalCoverage ?? ""}:${p.conformalRows?.length ?? 0}`)
    .join("|");

  useEffect(() => {
    if (!enabled || partitions.length === 0) {
      setState({ data: [], isLoading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ data: [], isLoading: true, error: null });

    Promise.all(partitions.map((p) => fetchOne(p, workspaceId)))
      .then((results) => {
        if (cancelled) return;
        const counts = new Set(results.filter(result => result.nSamples > 0).map(result => result.outputCount));
        if (counts.size > 1) throw new Error("Selected partitions have different numbers of outputs");
        setOutputIndex(0);
        setState({ data: results, isLoading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load prediction data";
        setState({ data: [], isLoading: false, error: message });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, workspaceId, enabled]);

  const outputCount = Math.max(1, ...state.data.map(dataset => dataset.outputCount ?? 1));
  const outputIndex = Math.min(selectedOutput, outputCount - 1);
  const data = useMemo(() => state.data.map(dataset => ({
    ...dataset,
    outputIndex,
    yTrue: coercePredictionVector(dataset.rawYTrue, outputIndex),
    yPred: coercePredictionVector(dataset.rawYPred, outputIndex),
  })), [state.data, outputIndex]);
  return { ...state, data, outputCount, outputIndex, setOutputIndex };

}
