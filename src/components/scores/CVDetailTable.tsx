import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMetricValue, getMetricAbbreviation } from "@/lib/scores";
import { getChainPartitionDetail } from "@/api/client";
import type { PartitionPrediction } from "@/types/aggregated-predictions";

interface CVDetailTableProps {
  chainId: string;
  selectedMetrics: string[];
  metric: string | null;
  enabled?: boolean;
}

const FOLD_ORDER: Record<string, number> = { final: 0, avg: 1, w_avg: 2 };

function foldSort(a: PartitionPrediction, b: PartitionPrediction): number {
  const aOrder = FOLD_ORDER[a.fold_id] ?? (100 + parseInt(a.fold_id || "999"));
  const bOrder = FOLD_ORDER[b.fold_id] ?? (100 + parseInt(b.fold_id || "999"));
  if (aOrder !== bOrder) return aOrder - bOrder;
  const partOrder = ["val", "test", "train"];
  return partOrder.indexOf(a.partition) - partOrder.indexOf(b.partition);
}

function foldBadge(foldId: string) {
  if (foldId === "final") return <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-500">Final</Badge>;
  if (foldId === "avg") return <Badge variant="outline" className="text-[9px] border-chart-1/30 text-chart-1">Avg</Badge>;
  if (foldId === "w_avg") return <Badge variant="outline" className="text-[9px] border-indigo-500/30 text-indigo-500">W-Avg</Badge>;
  return <Badge variant="secondary" className="text-[9px]">Fold {foldId}</Badge>;
}

/**
 * CV Detail table showing per-fold scores for a chain.
 * Fetches fold-level predictions from the API.
 */
export function CVDetailTable({ chainId, selectedMetrics, metric, enabled = true }: CVDetailTableProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["chain-partition-detail", chainId],
    queryFn: () => getChainPartitionDetail(chainId),
    enabled: enabled && !!chainId,
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4 text-muted-foreground text-xs gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading fold details...
      </div>
    );
  }

  const predictions = (data?.predictions || []).slice().sort(foldSort);

  if (predictions.length === 0) {
    return <div className="text-xs text-muted-foreground text-center py-3">No fold data available</div>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent text-[11px]">
            <TableHead>Fold</TableHead>
            <TableHead>Partition</TableHead>
            <TableHead className="text-right">N</TableHead>
            {selectedMetrics.map(k => (
              <TableHead key={k} className="text-right">{getMetricAbbreviation(k)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {predictions.map((pred) => {
            const isFinal = pred.fold_id === "final";
            const isAgg = pred.fold_id === "avg" || pred.fold_id === "w_avg";

            return (
              <TableRow
                key={pred.prediction_id}
                className={cn(
                  "text-xs",
                  isFinal && "bg-emerald-500/5",
                  isAgg && "bg-muted/30",
                  !isFinal && !isAgg && "hover:bg-muted/20",
                )}
              >
                <TableCell>{foldBadge(pred.fold_id)}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-[9px]">{pred.partition}</Badge>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{pred.n_samples ?? "—"}</TableCell>
                {selectedMetrics.map(k => {
                  // Try to get metric from the scores JSON, fall back to primary score fields
                  let val: number | null | undefined;
                  if (pred.scores && typeof pred.scores === "object") {
                    val = (pred.scores as Record<string, number>)?.[k];
                  }
                  if (val == null) {
                    if (k === metric || k === "rmse") {
                      if (pred.partition === "val") val = pred.val_score;
                      else if (pred.partition === "test") val = pred.test_score;
                      else val = pred.train_score;
                    }
                  }

                  return (
                    <TableCell key={k} className="text-right">
                      <span className={cn(
                        "font-mono text-[11px]",
                        isFinal ? "text-emerald-500 font-semibold" : isAgg ? "text-chart-1" : "text-foreground/80",
                      )}>
                        {val != null ? formatMetricValue(val, k) : "—"}
                      </span>
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
