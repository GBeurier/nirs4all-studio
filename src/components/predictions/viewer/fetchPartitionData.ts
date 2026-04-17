/**
 * Parallel fetching of prediction arrays for a set of ViewerPartitionTargets.
 *
 * Supports both the aggregated-predictions endpoint and the
 * workspace-scoped scatter endpoint via the target's `source` discriminator.
 */

import { useEffect, useState } from "react";
import {
  getN4AWorkspacePredictionScatter,
  getPredictionArrays,
} from "@/api/client";
import type { PartitionDataset, ViewerPartitionTarget } from "./types";

interface Options {
  partitions: ViewerPartitionTarget[];
  workspaceId?: string;
  /** If false, skip fetching (e.g. viewer not open). */
  enabled?: boolean;
}

interface State {
  data: PartitionDataset[];
  isLoading: boolean;
  error: string | null;
}

async function fetchOne(
  target: ViewerPartitionTarget,
  workspaceId: string | undefined,
): Promise<PartitionDataset> {
  if (target.source === "workspace") {
    if (!workspaceId) {
      throw new Error("workspaceId is required for workspace-source predictions");
    }
    const r = await getN4AWorkspacePredictionScatter(workspaceId, target.predictionId);
    return {
      predictionId: target.predictionId,
      partition: target.partition,
      label: target.label ?? target.partition,
      yTrue: r.y_true ?? [],
      yPred: r.y_pred ?? [],
      nSamples: r.n_samples ?? 0,
      sampleMetadata: r.sample_metadata ?? null,
    };
  }
  const r = await getPredictionArrays(target.predictionId);
  return {
    predictionId: target.predictionId,
    partition: target.partition,
    label: target.label ?? target.partition,
    yTrue: r.y_true ?? [],
    yPred: r.y_pred ?? [],
    nSamples: r.n_samples ?? (r.y_true?.length ?? 0),
    sampleMetadata: r.sample_metadata ?? null,
  };
}

/** Fetches all partitions in parallel; returns the combined state. */
export function usePartitionsData({ partitions, workspaceId, enabled = true }: Options): State {
  const [state, setState] = useState<State>({ data: [], isLoading: false, error: null });
  // Stable signature: predictionId + source — anything else won't change data.
  const signature = partitions
    .map((p) => `${p.source}:${p.predictionId}`)
    .join("|");

  useEffect(() => {
    if (!enabled || partitions.length === 0) {
      setState({ data: [], isLoading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    Promise.all(partitions.map((p) => fetchOne(p, workspaceId)))
      .then((results) => {
        if (cancelled) return;
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

  return state;
}
