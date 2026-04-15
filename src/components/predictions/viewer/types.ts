/**
 * Shared types for the unified prediction chart viewer.
 *
 * See plan at C:\Users\U108-N257\.claude\plans\glimmering-fluttering-deer.md
 */

import type { CategoricalPalette } from "@/lib/playground/colorConfig";

export type ChartKind = "scatter" | "residuals" | "confusion";

export type TaskKind = "regression" | "classification";

export type PaletteId = CategoricalPalette | "custom";

export type ExportTheme = "inherit" | "light" | "dark";

export type ConfusionNormalize = "none" | "row" | "col";

export type ConfusionGradientPreset = "ocean" | "lagoon" | "ember" | "orchid" | "moss" | "custom";

export interface ViewerPartitionColors {
  train: string;
  val: string;
  test: string;
}

export interface ViewerGradientColors {
  low: string;
  high: string;
}

export interface ViewerPartitionTarget {
  /** Stable id (prediction_id). */
  predictionId: string;
  /** Lowercase partition label ("train"|"val"|"test"|other). */
  partition: string;
  /** Human label (can equal partition, but preserve casing for display). */
  label?: string;
  /** Source picking which fetch endpoint to use:
   *  - "aggregated" → getPredictionArrays(predictionId)
   *  - "workspace"  → getN4AWorkspacePredictionScatter(workspaceId, predictionId)
   */
  source: "aggregated" | "workspace";
}

export interface ViewerHeader {
  datasetName: string;
  modelName: string | null;
  preprocessings?: string | null;
  foldId?: string | null;
  taskType?: string | null;
  /** For "Validation" / "Test" metric display in the strip. */
  valScore?: number | null;
  testScore?: number | null;
  trainScore?: number | null;
  nSamples?: number | null;
  nFeatures?: number | null;
}

export interface ChartConfig {
  palette: PaletteId;
  partitionColors: ViewerPartitionColors;
  partitionColoring: boolean;
  exportTheme: ExportTheme;
  rescaleToVisible: boolean;

  pointSize: number;      // 2..10, default 4
  pointOpacity: number;   // 0.3..1, default 0.7
  identityLine: boolean;  // default true
  regressionLine: boolean;// default false
  jitter: boolean;        // default false
  zeroLine: boolean;      // default true (residuals)
  sigmaBand: boolean;     // default false (residuals)

  confusionNormalize: ConfusionNormalize;
  confusionGradientPreset: ConfusionGradientPreset;
  confusionGradient: ViewerGradientColors;
  confusionShowTotals: boolean;   // default true
  confusionShowPercent: boolean;  // default false
}

export const DEFAULT_CHART_CONFIG: ChartConfig = {
  palette: "default",
  partitionColors: {
    train: "#17cfb9",
    val: "#266bd9",
    test: "#1cca5b",
  },
  partitionColoring: true,
  exportTheme: "inherit",
  rescaleToVisible: false,

  pointSize: 4,
  pointOpacity: 0.7,
  identityLine: true,
  regressionLine: false,
  jitter: false,
  zeroLine: true,
  sigmaBand: false,

  confusionNormalize: "none",
  confusionGradientPreset: "ocean",
  confusionGradient: {
    low: "#eef6ff",
    high: "#1d4ed8",
  },
  confusionShowTotals: true,
  confusionShowPercent: false,
};

/** One partition's resolved arrays, ready for rendering. */
export interface PartitionDataset {
  predictionId: string;
  partition: string;
  label: string;
  yTrue: number[];
  yPred: number[];
  nSamples: number;
}

export interface PredictionViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  header: ViewerHeader;
  partitions: ViewerPartitionTarget[];
  workspaceId?: string;
  initialKind?: ChartKind;
}

export interface PredictionPreviewProps {
  header: ViewerHeader;
  partitions: ViewerPartitionTarget[];
  workspaceId?: string;
  onOpenViewer: (kind: ChartKind) => void;
}
