/**
 * useDatasetBinding - Hook for managing dataset binding in Pipeline Editor
 *
 * Phase 4 Implementation: Pipeline Integration
 * @see docs/ROADMAP_DATASETS_WORKSPACE.md
 *
 * Features:
 * - T4.2: Store binding in local state (not saved with pipeline)
 * - T4.3: Pass bound dataset info to step components
 *
 * The binding is stored in session storage so it persists across
 * page refreshes but not across browser sessions. This is intentional
 * as the binding is meant to be temporary for the editing session.
 */

import { useState, useCallback, useEffect } from "react";
import { listDatasets } from "@/api/client";
import type { Dataset } from "@/types/datasets";
import type { BoundDataset, DataShape } from "@/components/pipeline-editor/DatasetBinding";

const STORAGE_KEY = "nirs4all_pipeline_dataset_binding";

/**
 * Storage format for bound dataset
 */
interface StoredBinding {
  pipelineId: string;
  datasetId: string;
  selectedTarget?: string;
  timestamp: number;
}

/**
 * Load binding from session storage
 */
function loadBinding(pipelineId: string): StoredBinding | null {
  try {
    const stored = sessionStorage.getItem(`${STORAGE_KEY}_${pipelineId}`);
    if (stored) {
      const binding = JSON.parse(stored) as StoredBinding;
      // Check if binding is recent (within 24 hours)
      if (Date.now() - binding.timestamp < 24 * 60 * 60 * 1000) {
        return binding;
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Save binding to session storage
 */
function saveBinding(pipelineId: string, binding: StoredBinding | null): void {
  try {
    const key = `${STORAGE_KEY}_${pipelineId}`;
    if (binding) {
      sessionStorage.setItem(key, JSON.stringify(binding));
    } else {
      sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Convert Dataset to BoundDataset
 */
function datasetToBoundDataset(
  dataset: Dataset,
  selectedTarget?: string
): BoundDataset {
  const shape: DataShape = {
    samples: dataset.num_samples || 0,
    features: dataset.num_features || 0,
    sources: dataset.n_sources,
  };

  return {
    id: dataset.id,
    name: dataset.name,
    path: dataset.path,
    shape,
    targets: dataset.targets,
    selectedTarget: selectedTarget || dataset.default_target,
    taskType: dataset.task_type as "regression" | "classification" | undefined,
  };
}

/**
 * Hook options
 */
export interface UseDatasetBindingOptions {
  /** Pipeline ID for storage key */
  pipelineId: string;
  /** Whether to persist binding across refreshes */
  persistBinding?: boolean;
}

/**
 * Hook return value
 */
export interface UseDatasetBindingReturn {
  /** Currently bound dataset (null if none) */
  boundDataset: BoundDataset | null;
  /** All available datasets */
  datasets: Dataset[];
  /** Whether datasets are loading */
  isLoading: boolean;
  /** Bind a dataset */
  bindDataset: (dataset: Dataset) => void;
  /** Clear the current binding */
  clearBinding: () => void;
  /** Select a target for the bound dataset */
  selectTarget: (targetColumn: string) => void;
  /** Refresh the datasets list */
  refreshDatasets: () => Promise<void>;
  /** Error message if any */
  error: string | null;
}

/**
 * Hook for managing dataset binding in Pipeline Editor
 */
export function useDatasetBinding({
  pipelineId,
  persistBinding = true,
}: UseDatasetBindingOptions): UseDatasetBindingReturn {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [boundDataset, setBoundDataset] = useState<BoundDataset | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Load datasets on mount
  const loadDatasets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await listDatasets();
      setDatasets(response.datasets);
      return response.datasets;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load datasets");
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initialize and restore binding on mount
  useEffect(() => {
    if (initialized) return;

    const init = async () => {
      const loadedDatasets = await loadDatasets();

      // Try to restore binding from storage
      if (persistBinding) {
        const storedBinding = loadBinding(pipelineId);
        if (storedBinding) {
          const dataset = loadedDatasets.find(
            (d) => d.id === storedBinding.datasetId
          );
          if (dataset && dataset.status === "available") {
            setBoundDataset(
              datasetToBoundDataset(dataset, storedBinding.selectedTarget)
            );
          }
        }
      }

      setInitialized(true);
    };

    init();
  }, [pipelineId, persistBinding, loadDatasets, initialized]);

  // Bind a dataset
  const bindDataset = useCallback(
    (dataset: Dataset) => {
      const bound = datasetToBoundDataset(dataset);
      setBoundDataset(bound);

      if (persistBinding) {
        saveBinding(pipelineId, {
          pipelineId,
          datasetId: dataset.id,
          selectedTarget: bound.selectedTarget,
          timestamp: Date.now(),
        });
      }
    },
    [pipelineId, persistBinding]
  );

  // Clear the binding
  const clearBinding = useCallback(() => {
    setBoundDataset(null);
    if (persistBinding) {
      saveBinding(pipelineId, null);
    }
  }, [pipelineId, persistBinding]);

  // Select a target
  const selectTarget = useCallback(
    (targetColumn: string) => {
      if (!boundDataset) return;

      const updatedBound = {
        ...boundDataset,
        selectedTarget: targetColumn,
      };
      setBoundDataset(updatedBound);

      if (persistBinding) {
        saveBinding(pipelineId, {
          pipelineId,
          datasetId: boundDataset.id,
          selectedTarget: targetColumn,
          timestamp: Date.now(),
        });
      }
    },
    [boundDataset, pipelineId, persistBinding]
  );

  // Refresh datasets
  const refreshDatasets = useCallback(async () => {
    const loadedDatasets = await loadDatasets();

    // Update bound dataset if it exists
    if (boundDataset) {
      const updated = loadedDatasets.find((d) => d.id === boundDataset.id);
      if (updated && updated.status === "available") {
        setBoundDataset(
          datasetToBoundDataset(updated, boundDataset.selectedTarget)
        );
      } else if (!updated || updated.status !== "available") {
        // Dataset no longer available, clear binding
        clearBinding();
      }
    }
  }, [loadDatasets, boundDataset, clearBinding]);

  return {
    boundDataset,
    datasets,
    isLoading,
    bindDataset,
    clearBinding,
    selectTarget,
    refreshDatasets,
    error,
  };
}
