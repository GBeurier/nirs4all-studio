import { useTranslation } from "react-i18next";

import {
  PARTITION_COLORS,
  normalizePartition,
  type PartitionKey,
} from "@/lib/partitionColors";
import { getPartitionLabel } from "@/components/predictions/predictionLabels";
import { getPartitionColor } from "@/components/predictions/viewer/palettes";
import type { ChartConfig } from "@/components/predictions/viewer/types";

interface PartitionLegendProps {
  partitions: Array<{ partition: string; label?: string }>;
  config?: Pick<ChartConfig, "palette" | "partitionColors">;
}

export function PartitionLegend({ partitions, config }: PartitionLegendProps) {
  const { t } = useTranslation();
  if (partitions.length === 0) return null;

  const seen = new Set<string>();
  const dedup = partitions.filter((partition) => {
    const key = partition.partition.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {dedup.map((partition) => {
        const key = normalizePartition(partition.partition) as PartitionKey | null;
        const color = config ? getPartitionColor(partition.partition, config.palette, config.partitionColors)
          : key ? PARTITION_COLORS[key] : "hsl(var(--muted-foreground))";
        return (
          <span
            key={partition.partition}
            className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            {partition.label ?? getPartitionLabel(t, partition.partition)}
          </span>
        );
      })}
    </div>
  );
}
