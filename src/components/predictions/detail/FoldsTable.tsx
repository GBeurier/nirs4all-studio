/**
 * FoldsTable — per-fold prediction rows with partition filter.
 *
 * Row click selects the fold (drives the chart tiles and arrays block in
 * the parent panel). The external-link icon on each row invokes the full
 * PredictionViewer scoped to that specific fold's partitions.
 */

import { ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { partitionBadgeClass } from "@/lib/partitionColors";
import type { PartitionPrediction } from "@/types/aggregated-predictions";

interface FoldsTableProps {
  rows: PartitionPrediction[];
  loading: boolean;
  partitionFilter: string;
  onPartitionFilterChange: (value: string) => void;
  selectedPredictionId: string | null;
  onSelect: (predictionId: string) => void;
  onOpenViewerForFold?: (predictionId: string) => void;
}

function formatScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(4);
}

function PartitionBadge({ partition }: { partition: string }) {
  return (
    <Badge variant="outline" className={cn("text-[10px] font-medium", partitionBadgeClass(partition))}>
      {partition}
    </Badge>
  );
}

export function FoldsTable({
  rows,
  loading,
  partitionFilter,
  onPartitionFilterChange,
  selectedPredictionId,
  onSelect,
  onOpenViewerForFold,
}: FoldsTableProps) {
  const filtered =
    partitionFilter === "all" ? rows : rows.filter((r) => r.partition === partitionFilter);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold tracking-tight">Fold-level predictions</div>
          <div className="text-[11px] text-muted-foreground">
            Click a row to update the charts and raw arrays above.
          </div>
        </div>
        <Select value={partitionFilter} onValueChange={onPartitionFilterChange}>
          <SelectTrigger className="h-8 w-[120px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All partitions</SelectItem>
            <SelectItem value="val">Val only</SelectItem>
            <SelectItem value="test">Test only</SelectItem>
            <SelectItem value="train">Train only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-lg border border-border/70 bg-card/40">
          <ScrollArea className="h-[320px]">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                <TableRow className="border-border/60">
                  <TableHead className="w-14 text-[11px]">Fold</TableHead>
                  <TableHead className="w-16 text-[11px]">Part.</TableHead>
                  <TableHead className="text-right text-[11px]">Val</TableHead>
                  <TableHead className="text-right text-[11px]">Test</TableHead>
                  <TableHead className="text-right text-[11px]">Train</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const isSelected = selectedPredictionId === row.prediction_id;
                  return (
                    <TableRow
                      key={row.prediction_id}
                      data-state={isSelected ? "selected" : undefined}
                      className={cn(
                        "cursor-pointer border-border/40 transition-colors",
                        isSelected && "bg-primary/5 hover:bg-primary/10",
                      )}
                      onClick={() => onSelect(row.prediction_id)}
                    >
                      <TableCell className="font-mono text-xs tabular-nums">
                        {row.fold_id}
                      </TableCell>
                      <TableCell>
                        <PartitionBadge partition={row.partition} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatScore(row.val_score)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatScore(row.test_score)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatScore(row.train_score)}
                      </TableCell>
                      <TableCell className="p-0 pr-2 text-right">
                        {onOpenViewerForFold && (
                          <button
                            type="button"
                            aria-label="Open this fold in the chart viewer"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenViewerForFold(row.prediction_id);
                            }}
                            className={cn(
                              "inline-flex h-6 w-6 items-center justify-center rounded-md",
                              "text-muted-foreground opacity-0 transition-opacity",
                              "hover:bg-muted hover:text-primary focus-visible:opacity-100",
                              "group-hover:opacity-100",
                              isSelected ? "opacity-80" : "",
                            )}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                      No predictions match this filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
