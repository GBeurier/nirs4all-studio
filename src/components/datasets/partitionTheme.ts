import type { PartitionKey } from "@/types/datasets";

export interface PartitionVisualTheme {
  label: string;
  lineColor: string;
  rangeFillColor: string;
  histogramColor: string;
  activeButtonClass: string;
  dotClass: string;
}

const PARTITION_THEMES: Record<PartitionKey, PartitionVisualTheme> = {
  train: {
    label: "Train",
    lineColor: "#0f766e",
    rangeFillColor: "rgba(15, 118, 110, 0.14)",
    histogramColor: "#14b8a6",
    activeButtonClass: "bg-teal-700 text-white hover:bg-teal-700 focus-visible:ring-teal-500",
    dotClass: "bg-teal-400",
  },
  test: {
    label: "Test",
    lineColor: "#b45309",
    rangeFillColor: "rgba(180, 83, 9, 0.16)",
    histogramColor: "#f59e0b",
    activeButtonClass: "bg-amber-500 text-amber-950 hover:bg-amber-500 focus-visible:ring-amber-400",
    dotClass: "bg-amber-300",
  },
  all: {
    label: "Both",
    lineColor: "#0284c7",
    rangeFillColor: "rgba(2, 132, 199, 0.14)",
    histogramColor: "#38bdf8",
    activeButtonClass: "bg-sky-600 text-white hover:bg-sky-600 focus-visible:ring-sky-400",
    dotClass: "bg-sky-300",
  },
};

export function getPartitionTheme(partition: PartitionKey): PartitionVisualTheme {
  return PARTITION_THEMES[partition];
}