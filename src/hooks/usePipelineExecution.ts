/**
 * Hook for executing pipelines with real-time progress tracking.
 *
 * Phase 6 Implementation:
 * - Execute pipeline via API
 * - Track progress via WebSocket
 * - Handle results and errors
 * - Export pipeline to various formats
 */

import { useState, useCallback, useEffect } from "react";
import { useJobUpdates } from "./useWebSocket";
import { api, getApiErrorMessage } from "@/api/transport";
import { listDatasets } from "@/api/datasets";
import type { Dataset as DatasetInfo } from "@/types/datasets";
import {
  getDatasetMetadataColumns,
  getDatasetRepetitionColumn,
} from "@/lib/datasetGroupingFields";
import {
  normalizePipelineExecutionResult,
  toLegacyPipelineExecutePayload,
  type PipelineExecutionConfig,
  type PipelineExecutionResult,
} from "@/lib/pipelineExecutionContract";

// ============================================================================
// Types
// ============================================================================

export type ExecutionConfig = PipelineExecutionConfig;
export type ExecutionResult = PipelineExecutionResult;

export interface ExportOptions {
  format: "python" | "yaml" | "json";
  datasetPath?: string;
}

export interface ExportResult {
  success: boolean;
  format: string;
  filename: string;
  content: string;
  contentType: string;
}

export type ExecutionStatus =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

// ============================================================================
// Hook: usePipelineExecution
// ============================================================================

export function usePipelineExecution() {
  const [status, setStatus] = useState<ExecutionStatus>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polledProgress, setPolledProgress] = useState<{ progress: number; message: string } | null>(null);

  // Track progress via WebSocket
  const {
    isConnected,
    status: jobStatus,
    progress,
    progressMessage,
    metrics,
    result: jobResult,
    error: jobError,
  } = useJobUpdates(jobId);

  // Update status based on job status
  useEffect(() => {
    if (jobStatus === "running") {
      setStatus("running");
    } else if (jobStatus === "completed") {
      setStatus("completed");
      setPolledProgress(null);
      if (jobResult) {
        setResult(normalizePipelineExecutionResult(jobResult));
      }
    } else if (jobStatus === "failed") {
      const cancelled = jobError === "Job was cancelled" || jobError === "Cancelled";
      setStatus(cancelled ? "cancelled" : "failed");
      setError(cancelled ? null : jobError || "Execution failed");
    } else if (jobStatus === "cancelled") {
      setStatus("cancelled");
    }
  }, [jobStatus, jobResult, jobError]);

  useEffect(() => { setPolledProgress(null); }, [progress, progressMessage]);

  // A fast failure can precede the WebSocket subscription. The job snapshot
  // remains authoritative when an event was missed or the connection drops.
  const isActive = status === "starting" || status === "running";
  useEffect(() => {
    if (!jobId || !isActive) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let terminal = false;
      try {
        const snapshot = await api.get<{
          status: ExecutionStatus | "pending";
          progress: number;
          progress_message: string;
          error?: string | null;
        }>(`/training/${jobId}`);
        if (disposed) return;
        setPolledProgress({ progress: snapshot.progress, message: snapshot.progress_message });
        if (["completed", "failed", "cancelled"].includes(snapshot.status)) {
          terminal = true;
          setStatus(snapshot.status as ExecutionStatus);
          if (snapshot.status === "failed") setError(snapshot.error || "Execution failed");
          else setError(null);
        }
      } catch {
        // A transient polling error does not change the scientific job state.
      } finally {
        if (!disposed && !terminal) timer = setTimeout(() => void poll(), 1000);
      }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [jobId, isActive]);

  /**
   * Execute a pipeline with the given configuration.
   */
  const execute = useCallback(
    async (config: ExecutionConfig): Promise<string | null> => {
      setStatus("starting");
      setJobId(null);
      setPolledProgress(null);
      setError(null);
      setResult(null);

      try {
        const response = await api.post<{
          success: boolean;
          job_id: string;
          message: string;
        }>(`/pipelines/${config.pipelineId}/execute`, toLegacyPipelineExecutePayload(config));

        if (response.success) {
          setJobId(response.job_id);
          setStatus("running");
          return response.job_id;
        } else {
          throw new Error(response.message || "Execution failed to start");
        }
      } catch (err) {
        const message = getApiErrorMessage(err) ?? "Execution failed to start";
        setError(message);
        setStatus("failed");
        return null;
      }
    },
    []
  );

  /**
   * Cancel the current execution.
   */
  const cancel = useCallback(async () => {
    if (!jobId) return;

    try {
      setError(null);
      await api.post(`/training/${jobId}/stop`);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Failed to cancel execution");
    }
  }, [jobId]);

  /**
   * Reset the execution state.
   */
  const reset = useCallback(() => {
    setStatus("idle");
    setJobId(null);
    setResult(null);
    setError(null);
    setPolledProgress(null);
  }, []);

  return {
    status,
    jobId,
    isConnected,
    progress: status === "completed" ? 100 : polledProgress?.progress ?? progress,
    progressMessage: polledProgress?.message ?? progressMessage,
    metrics,
    result,
    error,
    execute,
    cancel,
    reset,
  };
}

// ============================================================================
// Hook: usePipelineExport
// ============================================================================

export function usePipelineExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Export a pipeline to the specified format.
   */
  const exportPipeline = useCallback(
    async (
      pipelineId: string,
      options: ExportOptions
    ): Promise<ExportResult | null> => {
      setIsExporting(true);
      setError(null);

      try {
        const response = await api.post<ExportResult>(
          `/pipelines/${pipelineId}/export`,
          {
            format: options.format,
            dataset_path: options.datasetPath,
          }
        );

        if (response.success) {
          return response;
        } else {
          throw new Error("Export failed");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Export failed";
        setError(message);
        return null;
      } finally {
        setIsExporting(false);
      }
    },
    []
  );

  /**
   * Download the exported content as a file.
   */
  const downloadExport = useCallback(
    (result: ExportResult, filename?: string) => {
      const blob = new Blob([result.content], { type: result.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    []
  );

  /**
   * Copy the exported content to clipboard.
   */
  const copyToClipboard = useCallback(
    async (result: ExportResult): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(result.content);
        return true;
      } catch (err) {
        console.error("Failed to copy to clipboard:", err);
        return false;
      }
    },
    []
  );

  return {
    isExporting,
    error,
    exportPipeline,
    downloadExport,
    copyToClipboard,
  };
}

// ============================================================================
// Hook: useDatasetSelection
// ============================================================================

export interface Dataset {
  id: string;
  name: string;
  path: string;
  numSamples?: number;
  numFeatures?: number;
  hasTarget?: boolean;
  metadataColumns?: string[];
  repetitionColumn?: string | null;
}

export function useDatasetSelection() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch available datasets.
   */
  const fetchDatasets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await listDatasets();
      setDatasets((response.datasets || []).map((dataset: DatasetInfo) => ({
        id: dataset.id,
        name: dataset.name,
        path: dataset.path,
        numSamples: dataset.num_samples,
        numFeatures: dataset.num_features,
        hasTarget: dataset.has_targets,
        metadataColumns: getDatasetMetadataColumns(dataset),
        repetitionColumn: getDatasetRepetitionColumn(dataset),
      })));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load datasets";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load datasets on mount
  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  return {
    datasets,
    isLoading,
    error,
    refresh: fetchDatasets,
  };
}

// ============================================================================
// Hook: usePipelineValidation
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  steps: Array<{
    index: number;
    name: string;
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>;
  errors: string[];
  warnings: string[];
}

export function usePipelineValidation() {
  const [isValidating, setIsValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  /**
   * Validate a pipeline configuration.
   */
  const validate = useCallback(
    async (steps: unknown[]): Promise<ValidationResult | null> => {
      setIsValidating(true);

      try {
        const response = await api.post<ValidationResult>(
          "/pipelines/validate",
          { steps }
        );
        setValidation(response);
        return response;
      } catch (err) {
        console.error("Validation error:", err);
        return null;
      } finally {
        setIsValidating(false);
      }
    },
    []
  );

  return {
    isValidating,
    validation,
    validate,
  };
}
