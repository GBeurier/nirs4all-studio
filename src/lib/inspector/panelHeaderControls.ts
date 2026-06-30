import type { InspectorChainField } from "@/lib/inspector/chartInputs";

export const INSPECTOR_PANEL_FIELD_LABELS = {
  model_class: "Model family",
  model_name: "Model",
  preprocessings: "Preprocessing",
  dataset_name: "Dataset",
  run_id: "Run",
  task_type: "Task",
  pipeline_id: "Pipeline",
} as const satisfies Record<InspectorChainField, string>;

export const INSPECTOR_BIAS_VARIANCE_GROUP_OPTIONS = [
  { value: "model_class", label: "Model" },
  { value: "preprocessings", label: "Preprocessing" },
  { value: "dataset_name", label: "Dataset" },
] as const;

export function getInspectorPanelFieldLabel(field: string): string {
  return INSPECTOR_PANEL_FIELD_LABELS[field as InspectorChainField] ?? field;
}
