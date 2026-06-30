import { Award } from "lucide-react";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface AggregatedResultsSectionHeaderProps {
  label: string;
  count: number;
  variant: "refit" | "cv";
}

export function AggregatedResultsSectionHeader({
  label,
  count,
  variant,
}: AggregatedResultsSectionHeaderProps) {
  if (count === 0) return null;
  const isRefit = variant === "refit";
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={8} className="py-1.5 px-3">
        <div className="flex items-center gap-2 text-[10px]">
          {isRefit && <Award className="h-3 w-3 text-emerald-500" />}
          <span className={cn(
            "font-medium uppercase tracking-wide",
            isRefit ? "text-emerald-600" : "text-muted-foreground",
          )}
          >
            {label}
          </span>
          <div className={cn("flex-1 border-t", isRefit ? "border-emerald-500/20" : "border-border/40")} />
          <span className="text-muted-foreground">{count}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}
