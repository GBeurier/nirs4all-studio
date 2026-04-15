import { useMemo, useCallback } from "react";
import type { UpdateDatasetRequest } from "@/api/client";
import { DatasetWizard } from "./DatasetWizard";
import { buildInitialState } from "./editDatasetPanelState";
import type {
  Dataset,
  DatasetConfig,
} from "@/types/datasets";

interface EditDatasetPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: Dataset | null;
  onSave: (datasetId: string, updates: UpdateDatasetRequest) => Promise<void>;
  onRefresh?: (datasetId: string) => Promise<void>;
  onVerify?: (datasetId: string) => Promise<void>;
}

export function EditDatasetPanel({
  open,
  onOpenChange,
  dataset,
  onSave,
}: EditDatasetPanelProps) {
  const initialState = useMemo(() => (dataset ? buildInitialState(dataset) : undefined), [dataset]);

  const handleSave = useCallback(async (_path: string, config?: Partial<DatasetConfig>) => {
    if (!dataset || !config) return;

    const updates: UpdateDatasetRequest = {
      config,
      default_target: config.default_target ?? dataset.default_target,
      task_type: config.task_type ?? dataset.task_type,
      signal_types: config.signal_type && config.signal_type !== "auto" ? [config.signal_type] : [],
    };

    await onSave(dataset.id, updates);
  }, [dataset, onSave]);

  if (!dataset || !initialState) {
    return null;
  }

  return (
    <DatasetWizard
      open={open}
      onOpenChange={onOpenChange}
      onAdd={handleSave}
      initialState={initialState}
      submitLabel="Save Changes"
      submitErrorMessage="Failed to save dataset"
    />
  );
}
