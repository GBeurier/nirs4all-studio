import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  cancelPublicDatasetImport,
  getPublicDatasetImport,
  listPublicDatasets,
  startPublicDatasetImport,
  type PublicDataset,
} from "@/api/public-datasets";
import { getApiErrorMessage } from "@/api/transport";
import type { Dataset } from "@/types/datasets";

import { useInvalidateDatasets, usePublishLinkedDataset } from "./useDatasetQueries";

const POLL_INTERVAL_MS = 1000;
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

export const publicDatasetQueryKeys = {
  catalog: ["public-datasets", "catalog"] as const,
};

/** Public catalogue listing; workspace independent and fetched only when requested. */
export function usePublicDatasetCatalog(enabled: boolean) {
  return useQuery({
    queryKey: publicDatasetQueryKeys.catalog,
    queryFn: listPublicDatasets,
    enabled,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
}

/** Case-insensitive match on name, id and domain. */
export function filterPublicDatasets(datasets: PublicDataset[], query: string): PublicDataset[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return datasets;
  return datasets.filter((dataset) =>
    [dataset.name, dataset.id, dataset.domain ?? ""].some((value) =>
      value.toLowerCase().includes(needle)));
}

export interface PublicDatasetSourceChoice {
  /** The dataset has several sources and the user must pick one. */
  required: boolean;
  /** Source sent with the import request, if any. */
  sourceId: string | undefined;
  ready: boolean;
}

/** Only a single-source dataset gets an implicit source; several sources need an explicit choice. */
export function resolvePublicDatasetSource(
  dataset: PublicDataset,
  chosenSourceId: string | null,
): PublicDatasetSourceChoice {
  if (dataset.n_sources > 1) {
    const valid = chosenSourceId !== null && dataset.source_ids.includes(chosenSourceId);
    return { required: true, sourceId: valid ? chosenSourceId : undefined, ready: valid };
  }
  return {
    required: false,
    sourceId: dataset.source_ids.length === 1 ? dataset.source_ids[0] : undefined,
    ready: true,
  };
}

export type PublicDatasetImportPhase =
  | "idle"
  | "submitting"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  /** Status polling failed repeatedly; the job may still be running. */
  | "disconnected";

export interface PublicDatasetImportState {
  phase: PublicDatasetImportPhase;
  jobId: string | null;
  publicDatasetId: string | null;
  sourceId: string | null;
  /** Destination bound at submission. */
  workspaceId: string | null;
  workspacePath: string | null;
  progress: number | null;
  progressMessage: string;
  cancelRequested: boolean;
  error: string | null;
  dataset: Dataset | null;
}

const IDLE_STATE: PublicDatasetImportState = {
  phase: "idle",
  jobId: null,
  publicDatasetId: null,
  sourceId: null,
  workspaceId: null,
  workspacePath: null,
  progress: null,
  progressMessage: "",
  cancelRequested: false,
  error: null,
  dataset: null,
};

const BUSY_PHASES: ReadonlySet<PublicDatasetImportPhase> = new Set([
  "submitting",
  "pending",
  "running",
  "disconnected",
]);

export function isPublicDatasetImportBusy(phase: PublicDatasetImportPhase): boolean {
  return BUSY_PHASES.has(phase);
}

function errorText(error: unknown, fallback: string): string {
  return getApiErrorMessage(error) || fallback;
}

interface UsePublicDatasetImportOptions {
  workspaceId: string | null;
  workspacePath: string | null;
}

/**
 * Submits a public dataset import and monitors its job serially until it is
 * terminal. Mount it at page level so closing the dialog keeps monitoring.
 */
export function usePublicDatasetImport({ workspaceId, workspacePath }: UsePublicDatasetImportOptions) {
  const [state, setState] = useState<PublicDatasetImportState>(IDLE_STATE);
  const publishLinkedDataset = usePublishLinkedDataset();
  const invalidateDatasets = useInvalidateDatasets();

  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const finishedJobRef = useRef<string | null>(null);
  const workspaceIdRef = useRef(workspaceId);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  busyRef.current = isPublicDatasetImportBusy(state.phase);

  // A terminal outcome describes the previous workspace; drop it on switch.
  // A running job keeps its submission-bound destination.
  useEffect(() => {
    if (workspaceIdRef.current === workspaceId) return;
    workspaceIdRef.current = workspaceId;
    setState((previous) => (isPublicDatasetImportBusy(previous.phase) ? previous : IDLE_STATE));
  }, [workspaceId]);

  const finishCompleted = useCallback((jobId: string, dataset: Dataset, destination: string | null) => {
    if (finishedJobRef.current === jobId) return;
    finishedJobRef.current = jobId;
    if (destination !== null && destination === workspaceIdRef.current) {
      try {
        publishLinkedDataset(dataset);
      } catch (error) {
        console.warn("Public dataset imported; publishing the record failed", error);
        void invalidateDatasets();
      }
      toast.success(`Added "${dataset.name}" to the workspace`);
      return;
    }
    // The active workspace changed after submission; the backend bound the destination then.
    void invalidateDatasets();
    toast.success(`Added "${dataset.name}" to the workspace it was imported into`);
  }, [invalidateDatasets, publishLinkedDataset]);

  const monitoring = state.phase === "pending" || state.phase === "running";
  const { jobId, workspaceId: destination } = state;

  useEffect(() => {
    if (!jobId || !monitoring) return;
    let disposed = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const snapshot = await getPublicDatasetImport(jobId);
        if (disposed) return;
        failures = 0;
        const progress = typeof snapshot.progress === "number" ? snapshot.progress : null;
        const progressMessage = typeof snapshot.progress_message === "string" ? snapshot.progress_message : "";

        switch (snapshot.status) {
          case "pending":
          case "running":
            setState((previous) => ({
              ...previous,
              phase: snapshot.status,
              progress,
              progressMessage,
              cancelRequested: Boolean(snapshot.cancellation_requested) || previous.cancelRequested,
            }));
            timer = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
            return;
          case "completed": {
            const dataset = snapshot.result?.success ? snapshot.result.dataset : null;
            if (!dataset) {
              setState((previous) => ({
                ...previous,
                phase: "failed",
                error: "The import finished without returning the added dataset.",
              }));
              void invalidateDatasets();
              return;
            }
            setState((previous) => ({
              ...previous,
              phase: "completed",
              progress: 100,
              progressMessage,
              error: null,
              dataset,
            }));
            finishCompleted(jobId, dataset, destination);
            return;
          }
          case "failed":
            setState((previous) => ({
              ...previous,
              phase: "failed",
              progressMessage,
              error: snapshot.error || "The import failed.",
            }));
            return;
          case "cancelled":
            setState((previous) => ({ ...previous, phase: "cancelled", progressMessage, error: null }));
            return;
          default:
            setState((previous) => ({
              ...previous,
              phase: "failed",
              error: `Unexpected import status: ${String(snapshot.status)}`,
            }));
        }
      } catch (error) {
        if (disposed) return;
        failures += 1;
        if (failures < MAX_CONSECUTIVE_POLL_FAILURES) {
          timer = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS * failures);
          return;
        }
        setState((previous) => ({
          ...previous,
          phase: "disconnected",
          error: `Lost contact with the import job: ${errorText(error, "status request failed")}`,
        }));
      }
    };

    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [destination, finishCompleted, invalidateDatasets, jobId, monitoring]);

  const start = useCallback(async (publicDatasetId: string, sourceId?: string) => {
    if (busyRef.current) return;
    if (!workspaceId) {
      setState({ ...IDLE_STATE, error: "Select a workspace before importing a public dataset." });
      return;
    }
    busyRef.current = true;
    setState({
      ...IDLE_STATE,
      phase: "submitting",
      publicDatasetId,
      sourceId: sourceId ?? null,
      workspaceId,
      workspacePath,
    });
    try {
      const submission = await startPublicDatasetImport(
        sourceId ? { dataset_id: publicDatasetId, source_id: sourceId } : { dataset_id: publicDatasetId },
      );
      if (!mountedRef.current) return;
      setState((previous) => ({
        ...previous,
        jobId: submission.job_id,
        // The first poll reports the authoritative status, terminal or not.
        phase: submission.status === "running" ? "running" : "pending",
      }));
    } catch (error) {
      if (!mountedRef.current) return;
      setState((previous) => ({
        ...previous,
        phase: "failed",
        error: errorText(error, "The import could not be started."),
      }));
    }
  }, [workspaceId, workspacePath]);

  const cancel = useCallback(async () => {
    if (!jobId || !monitoring || state.cancelRequested) return;
    setState((previous) => ({ ...previous, cancelRequested: true }));
    try {
      await cancelPublicDatasetImport(jobId);
    } catch (error) {
      if (!mountedRef.current) return;
      setState((previous) => ({
        ...previous,
        cancelRequested: false,
        error: `Could not cancel the import: ${errorText(error, "request failed")}`,
      }));
    }
  }, [jobId, monitoring, state.cancelRequested]);

  /** Resume polling after repeated status failures. */
  const resume = useCallback(() => {
    setState((previous) => (previous.phase === "disconnected" && previous.jobId
      ? { ...previous, phase: "running", error: null }
      : previous));
  }, []);

  /** Clear a terminal outcome. A busy import is never discarded. */
  const reset = useCallback(() => {
    setState((previous) => (isPublicDatasetImportBusy(previous.phase) && previous.phase !== "disconnected"
      ? previous
      : IDLE_STATE));
  }, []);

  return { state, start, cancel, resume, reset };
}

export type PublicDatasetImportController = ReturnType<typeof usePublicDatasetImport>;
