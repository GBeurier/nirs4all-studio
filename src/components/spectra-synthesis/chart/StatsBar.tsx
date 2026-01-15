/**
 * StatsBar - Compact statistics display row
 *
 * Shows key statistics in a horizontal row below the chart:
 * - Sample count
 * - Wavelength count
 * - Mean/Std values
 * - Execution time
 */

import { Badge } from "@/components/ui/badge";
import {
  BarChart3,
  Clock,
  Hash,
  TrendingUp,
  Sigma,
} from "lucide-react";
import type { PreviewData } from "../contexts";
import { cn } from "@/lib/utils";

interface StatsBarProps {
  data: PreviewData;
  className?: string;
}

export function StatsBar({ data, className }: StatsBarProps) {
  const stats = data.statistics;

  return (
    <div
      className={cn(
        "flex items-center gap-2 flex-wrap px-2 py-1.5 bg-muted/30 rounded-md",
        className
      )}
    >
      {/* Sample count */}
      <StatBadge
        icon={<Hash className="h-3 w-3" />}
        label="Samples"
        value={data.spectra.length.toString()}
        tooltip={`Preview: ${data.spectra.length} / Total: ${data.actual_samples}`}
      />

      {/* Wavelengths */}
      <StatBadge
        icon={<BarChart3 className="h-3 w-3" />}
        label="Wavelengths"
        value={data.wavelengths.length.toString()}
      />

      {/* Spectra mean */}
      {stats && (
        <StatBadge
          icon={<TrendingUp className="h-3 w-3" />}
          label="Mean"
          value={stats.spectra_mean.toFixed(3)}
        />
      )}

      {/* Spectra std */}
      {stats && (
        <StatBadge
          icon={<Sigma className="h-3 w-3" />}
          label="Std"
          value={stats.spectra_std.toFixed(3)}
        />
      )}

      {/* Target range */}
      {stats && (
        <StatBadge
          label="Target"
          value={`${stats.targets_min.toFixed(1)} - ${stats.targets_max.toFixed(1)}`}
        />
      )}

      {/* Execution time */}
      <StatBadge
        icon={<Clock className="h-3 w-3" />}
        label="Time"
        value={`${data.execution_time_ms.toFixed(0)}ms`}
        variant="secondary"
      />
    </div>
  );
}

interface StatBadgeProps {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tooltip?: string;
  variant?: "default" | "secondary";
}

function StatBadge({
  icon,
  label,
  value,
  variant = "default",
}: StatBadgeProps) {
  return (
    <Badge
      variant={variant === "secondary" ? "secondary" : "outline"}
      className="h-6 gap-1 font-normal text-xs"
    >
      {icon}
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono font-medium">{value}</span>
    </Badge>
  );
}
