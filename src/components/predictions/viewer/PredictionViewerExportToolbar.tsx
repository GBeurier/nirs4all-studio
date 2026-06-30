import {
  FileSpreadsheet,
  ImageDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartConfigPopover } from "./ChartConfigPopover";
import type {
  ChartConfig,
  ChartKind,
  ViewerMetadataType,
} from "./types";

interface PredictionViewerExportToolbarProps {
  canExport: boolean;
  config: ChartConfig;
  kind: ChartKind;
  metadataColumns: string[];
  onChangeConfig: (next: ChartConfig | ((prev: ChartConfig) => ChartConfig)) => void;
  onExportCsv: () => void;
  onExportPng: () => void;
  onResetConfig: () => void;
  resolvedMetadataType: ViewerMetadataType | null;
}

export function PredictionViewerExportToolbar({
  canExport,
  config,
  kind,
  metadataColumns,
  onChangeConfig,
  onExportCsv,
  onExportPng,
  onResetConfig,
  resolvedMetadataType,
}: PredictionViewerExportToolbarProps) {
  return (
    <div className="flex items-center justify-end gap-2 border-b px-5 py-2">
      <ChartConfigPopover
        kind={kind}
        config={config}
        metadataColumns={metadataColumns}
        resolvedMetadataType={resolvedMetadataType}
        onChange={onChangeConfig}
        onReset={onResetConfig}
      />
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={onExportPng}
        disabled={!canExport}
      >
        <ImageDown className="h-3.5 w-3.5" />
        PNG
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={onExportCsv}
        disabled={!canExport}
      >
        <FileSpreadsheet className="h-3.5 w-3.5" />
        CSV
      </Button>
    </div>
  );
}
