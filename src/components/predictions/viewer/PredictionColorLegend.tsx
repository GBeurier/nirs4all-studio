import { useMemo } from "react";
import {
  getCategoricalColor,
  getContinuousPaletteGradient,
} from "@/lib/playground/colorConfig";
import { cn } from "@/lib/utils";
import { buildPredictionColoration } from "./coloration";
import { getPartitionColor } from "./palettes";
import type { ChartConfig, PartitionDataset } from "./types";

interface PredictionColorLegendProps {
  datasets: PartitionDataset[];
  config: ChartConfig;
  className?: string;
  maxItems?: number;
}

export function PredictionColorLegend({
  datasets,
  config,
  className,
  maxItems = 8,
}: PredictionColorLegendProps) {
  const coloration = useMemo(
    () => buildPredictionColoration(datasets, config),
    [datasets, config],
  );

  if (datasets.length === 0) return null;
  if (config.colorMode === "metadata" && !coloration.metadataKey) return null;

  if (
    config.colorMode === "metadata"
    && coloration.metadataKey
    && coloration.metadataType === "continuous"
    && coloration.metadataRange
  ) {
    const { min, max } = coloration.metadataRange;
    return (
      <div className={cn("flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground", className)}>
        <span className="font-medium text-foreground">{coloration.metadataKey}</span>
        <span
          aria-hidden
          className="h-2.5 w-24 rounded-full border border-border/60"
          style={{ backgroundImage: getContinuousPaletteGradient(config.continuousPalette) }}
        />
        <span>{Number.isFinite(min) ? min : "—"}</span>
        <span>→</span>
        <span>{Number.isFinite(max) ? max : "—"}</span>
      </div>
    );
  }

  if (
    config.colorMode === "metadata"
    && coloration.metadataKey
    && coloration.metadataType === "categorical"
    && coloration.metadataCategories.length > 0
  ) {
    const visibleCategories = coloration.metadataCategories.slice(0, maxItems);
    const remaining = coloration.metadataCategories.length - visibleCategories.length;

    return (
      <div className={cn("flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground", className)}>
        <span className="font-medium text-foreground">{coloration.metadataKey}</span>
        {visibleCategories.map((category, index) => (
          <div key={category} className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: getCategoricalColor(index, config.categoricalPalette) }}
            />
            <span>{category}</span>
          </div>
        ))}
        {remaining > 0 && <span>+{remaining} more</span>}
      </div>
    );
  }

  const partitions = datasets.reduce<Array<{ key: string; label: string }>>((acc, dataset) => {
    if (acc.some((entry) => entry.key === dataset.partition)) return acc;
    acc.push({ key: dataset.partition, label: dataset.label });
    return acc;
  }, []);

  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground", className)}>
      {partitions.map((partition) => (
        <div key={partition.key} className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full"
            style={{
              backgroundColor: getPartitionColor(
                partition.key,
                config.palette,
                config.partitionColors,
              ),
            }}
          />
          <span>{partition.label}</span>
        </div>
      ))}
    </div>
  );
}
