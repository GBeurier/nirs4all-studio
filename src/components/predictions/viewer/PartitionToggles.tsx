/**
 * Chip row to toggle per-partition visibility inside the viewer.
 *
 * Not rendered when there are zero partitions. A single partition still
 * renders as an informational chip but is non-interactive.
 */

import { cn } from "@/lib/utils";
import { getPartitionColor } from "./palettes";
import type { PaletteId, ViewerPartitionColors, ViewerPartitionTarget } from "./types";

interface PartitionTogglesProps {
  partitions: ViewerPartitionTarget[];
  visible: Set<string>;
  onToggle: (partition: string) => void;
  palette: PaletteId;
  colors: ViewerPartitionColors;
}

export function PartitionToggles({
  partitions,
  visible,
  onToggle,
  palette,
  colors,
}: PartitionTogglesProps) {
  if (partitions.length === 0) return null;
  const interactive = partitions.length > 1;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {partitions.map((target) => {
        const isVisible = visible.has(target.partition);
        const color = getPartitionColor(target.partition, palette, colors);
        const label = target.label ?? target.partition;
        return (
          <button
            key={`${target.predictionId}-${target.partition}`}
            type="button"
            disabled={!interactive}
            onClick={() => interactive && onToggle(target.partition)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
              interactive
                ? "cursor-pointer hover:bg-muted"
                : "cursor-default",
              isVisible
                ? "border-border bg-card text-foreground"
                : "border-border/50 bg-muted/30 text-muted-foreground opacity-60",
            )}
            aria-pressed={isVisible}
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: isVisible ? color : "transparent", borderColor: color, borderWidth: 1, borderStyle: "solid" }}
            />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
