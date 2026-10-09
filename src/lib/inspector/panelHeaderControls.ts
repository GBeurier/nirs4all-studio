import type { TFunction } from "i18next";
import type { InspectorChainField } from "@/lib/inspector/chartInputs";

export const INSPECTOR_PANEL_FIELD_LABEL_KEYS = {
  model_class: "inspector.fields.modelFamily",
  model_name: "inspector.fields.model",
  preprocessings: "inspector.fields.preprocessing",
  dataset_name: "inspector.fields.dataset",
  run_id: "inspector.fields.run",
  task_type: "inspector.fields.task",
  pipeline_id: "inspector.fields.pipeline",
} as const satisfies Record<InspectorChainField, string>;

export const INSPECTOR_BIAS_VARIANCE_GROUP_OPTIONS = [
  { value: "model_class", labelKey: "inspector.fields.model" },
  { value: "preprocessings", labelKey: "inspector.fields.preprocessing" },
  { value: "dataset_name", labelKey: "inspector.fields.dataset" },
] as const;

export function getInspectorPanelFieldLabel(field: string, t: TFunction): string {
  const labelKey = INSPECTOR_PANEL_FIELD_LABEL_KEYS[field as InspectorChainField];
  return labelKey ? t(labelKey) : field;
}
