import {
  Activity,
  BarChart3,
  Grid3x3,
  TrendingUp,
} from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PartitionToggles } from "./PartitionToggles";
import type {
  ChartKind,
  PaletteId,
  ViewerPartitionColors,
  ViewerPartitionTarget,
} from "./types";

interface PredictionViewerKindToolbarProps {
  availableKinds: ChartKind[];
  colors: ViewerPartitionColors;
  kind: ChartKind;
  onKindChange: (kind: ChartKind) => void;
  onTogglePartition: (partition: string) => void;
  palette: PaletteId;
  partitions: ViewerPartitionTarget[];
  visible: Set<string>;
}

export function PredictionViewerKindToolbar({
  availableKinds,
  colors,
  kind,
  onKindChange,
  onTogglePartition,
  palette,
  partitions,
  visible,
}: PredictionViewerKindToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-2">
      <ToggleGroup
        type="single"
        size="sm"
        value={kind}
        onValueChange={(value) => {
          if (value && availableKinds.includes(value as ChartKind)) {
            onKindChange(value as ChartKind);
          }
        }}
        className="justify-start"
      >
        {availableKinds.includes("scatter") && (
          <ToggleGroupItem value="scatter" className="h-8 gap-1.5 text-xs">
            <TrendingUp className="h-3.5 w-3.5" />
            Scatter
          </ToggleGroupItem>
        )}
        {availableKinds.includes("residuals") && (
          <ToggleGroupItem value="residuals" className="h-8 gap-1.5 text-xs">
            <BarChart3 className="h-3.5 w-3.5" />
            Residuals
          </ToggleGroupItem>
        )}
        {availableKinds.includes("confusion") && (
          <ToggleGroupItem value="confusion" className="h-8 gap-1.5 text-xs">
            <Grid3x3 className="h-3.5 w-3.5" />
            Confusion
          </ToggleGroupItem>
        )}
        {availableKinds.includes("distribution") && (
          <ToggleGroupItem value="distribution" className="h-8 gap-1.5 text-xs">
            <Activity className="h-3.5 w-3.5" />
            Distribution
          </ToggleGroupItem>
        )}
      </ToggleGroup>

      <PartitionToggles
        partitions={partitions}
        visible={visible}
        onToggle={onTogglePartition}
        palette={palette}
        colors={colors}
      />
    </div>
  );
}
