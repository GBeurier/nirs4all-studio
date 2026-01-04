/**
 * Hook for executing pipelines with real-time progress tracking.
 *
 * Phase 6 Implementation:
 * - Execute pipeline via API
 * - Track progress via WebSocket
 * - Handle results and errors
 * - Export pipeline to various formats
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useJobUpdates } from "./useWebSocket";
import { apiClient } from "@/api/client";

// ============================================================================
// Types
// ============================================================================

export interface ExecutionConfig {
  pipelineId: string;
  datasetId: string;
  verbose?: number;
  exportModel?: boolean;
  modelName?: string;
}

export interface ExecutionResult {
  success: boolean;
  metrics?: {
    rmse?: number;
    r2?: number;
    mae?: number;
    score?: number;
  };
  topResults?: Array<{
    rank: number;
    rmse?: number;
    r2?: number;
    config?: string;
  }>;
  variantsTested?: number;
  modelPath?: string;
  error?: string;
  traceback?: string;
}

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
      if (jobResult) {
        setResult(jobResult as ExecutionResult);
      }
    } else if (jobStatus === "failed") {
      setStatus("failed");
      setError(jobError || "Execution failed");
    } else if (jobStatus === "cancelled") {
      setStatus("cancelled");
    }
  }, [jobStatus, jobResult, jobError]);

  /**
   * Execute a pipeline with the given configuration.
   */
  const execute = useCallback(
    async (config: ExecutionConfig): Promise<string | null> => {
      setStatus("starting");
      setError(null);
      setResult(null);

      try {
        const response = await apiClient.post<{
          success: boolean;
          job_id: string;
          message: string;
        }>(`/pipelines/${config.pipelineId}/execute`, {
          dataset_id: config.datasetId,
          verbose: config.verbose ?? 1,
          export_model: config.exportModel ?? true,
          model_name: config.modelName,
        });

        if (response.data.success) {
          setJobId(response.data.job_id);
          setStatus("running");
          return response.data.job_id;
        } else {
          throw new Error(response.data.message || "Execution failed to start");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
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
      await apiClient.post(`/training/${jobId}/stop`);
      setStatus("cancelled");
    } catch (err) {
      console.error("Failed to cancel execution:", err);
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
  }, []);

  return {
    status,
    jobId,
    isConnected,
    progress,
    progressMessage,
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
        const response = await apiClient.post<ExportResult>(
          `/pipelines/${pipelineId}/export`,
          {
            format: options.format,
            dataset_path: options.datasetPath,
          }
        );

        if (response.data.success) {
          return response.data;
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
      const response = await apiClient.get<{ datasets: Dataset[] }>(
        "/datasets"
      );
      setDatasets(response.data.datasets || []);
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
        const response = await apiClient.post<ValidationResult>(
          "/pipelines/validate",
          { steps }
        );
        setValidation(response.data);
        return response.data;
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
