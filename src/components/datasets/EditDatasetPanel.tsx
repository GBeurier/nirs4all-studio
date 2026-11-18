import { useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateDatasetRequest } from "@/api/datasets";
import { DatasetWizard } from "./DatasetWizard";
import { buildDatasetUpdate, buildInitialState } from "./editDatasetPanelState";
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
  const { t } = useTranslation();
  const initialState = useMemo(() => (dataset ? buildInitialState(dataset) : undefined), [dataset]);

  const handleSave = useCallback(async (_path: string, config?: Partial<DatasetConfig>) => {
    if (!dataset || !config) return;
    await onSave(dataset.id, buildDatasetUpdate(dataset, config));
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
      submitLabel={t("datasets.editPanel.saveChanges")}
      submitErrorMessage={t("datasets.editPanel.saveFailed")}
    />
  );
}
