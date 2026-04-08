/**
 * PartitionToggle - Three-button group for selecting train / test / all partition.
 *
 * Used by dataset detail tabs to filter spectra previews, histograms, and metadata
 * by the dataset's native train/test partition. The "Test" and "All" buttons are
 * disabled when the dataset has no test partition.
 */
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PartitionKey } from "@/types/datasets";
import { getPartitionTheme } from "./partitionTheme";

interface PartitionToggleProps {
  value: PartitionKey;
  onChange: (value: PartitionKey) => void;
  hasTest: boolean;
  /** Optional sample counts shown as small annotations below labels. */
  trainCount?: number;
  testCount?: number;
  className?: string;
  size?: "sm" | "xs";
}

const OPTIONS: { value: PartitionKey; label: string }[] = [
  { value: "train", label: "Train" },
  { value: "test", label: "Test" },
  { value: "all", label: "Both" },
];

function formatCount(n: number | undefined): string | null {
  if (n === undefined || n === null) return null;
  return n.toLocaleString();
}

export const PartitionToggle = memo(function PartitionToggle({
  value,
  onChange,
  hasTest,
  trainCount,
  testCount,
  className,
  size = "sm",
}: PartitionToggleProps) {
  const heightClass = size === "xs" ? "h-7" : "h-8";
  return (
    <div
      role="group"
      aria-label="Partition filter"
      className={cn("inline-flex rounded-md border border-border bg-background overflow-hidden", className)}
    >
      {OPTIONS.map((opt) => {
        const disabled = opt.value !== "train" && !hasTest;
        const active = value === opt.value;
        const theme = getPartitionTheme(opt.value);
        const count = opt.value === "train" ? trainCount : opt.value === "test" ? testCount : trainCount !== undefined && testCount !== undefined ? trainCount + testCount : undefined;
        const countLabel = formatCount(count);
        return (
          <Button
            key={opt.value}
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              heightClass,
              "rounded-none border-0 text-xs font-medium px-3 gap-1.5 shadow-none",
              active ? theme.activeButtonClass : "text-muted-foreground hover:bg-muted",
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", !disabled && theme.dotClass, disabled && "bg-muted-foreground/30")} />
            <span>{opt.label}</span>
            {countLabel !== null && (
              <span className={cn("text-[10px] tabular-nums opacity-70", active && "opacity-90")}>
                {countLabel}
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
});
