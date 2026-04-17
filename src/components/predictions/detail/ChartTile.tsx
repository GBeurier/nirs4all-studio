/**
 * ChartTile — card wrapper for a single prediction chart in the detail panel.
 *
 * Provides the title row, "Customize →" link that defers to the parent's
 * onOpenViewer callback, and a fixed-height ResponsiveContainer region.
 */

import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChartTileProps {
  title: string;
  icon: ReactNode;
  /** Short caption below the chart (eg "y = Actual vs Predicted"). */
  subtitle?: string;
  /** Customize link text; defaults to "Customize →". */
  customizeLabel?: string;
  /** Called when the customize button is clicked. */
  onCustomize?: () => void;
  /** Optional height override; defaults to h-72 (288px). */
  height?: string;
  className?: string;
  children: ReactNode;
}

export function ChartTile({
  title,
  icon,
  subtitle,
  customizeLabel = "Customize",
  onCustomize,
  height = "h-72",
  className,
  children,
}: ChartTileProps) {
  return (
    <section
      className={cn(
        "group/tile flex min-w-0 flex-col rounded-2xl border border-border/70 bg-card/70 shadow-sm",
        "transition-colors hover:border-border",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-foreground">
              {title}
            </div>
            {subtitle && (
              <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
            )}
          </div>
        </div>
        {onCustomize && (
          <button
            type="button"
            onClick={onCustomize}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1",
              "text-[11px] font-medium text-muted-foreground",
              "transition-colors hover:bg-muted hover:text-primary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            )}
          >
            {customizeLabel}
            <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
      </header>
      <div className={cn("min-h-0 p-3", height)}>{children}</div>
    </section>
  );
}
