import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Database, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { getScoreDistribution, getAggregatedPredictions } from "@/api/client";
import { ScoreHistogram } from "./ScoreHistogram";

interface RunQuickViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  runName: string;
  datasetName: string;
  metric: string | null;
  workspaceId: string;
}

const PARTITIONS = ["val", "test", "train", "final"] as const;

const PARTITION_LABELS: Record<string, string> = {
  val: "Validation",
  test: "Test",
  train: "Train",
  final: "Final",
};

const PARTITION_COLORS: Record<string, string> = {
  val: "bg-chart-1/20 text-chart-1 border-chart-1/30",
  test: "bg-chart-2/20 text-chart-2 border-chart-2/30",
  train: "bg-chart-3/20 text-chart-3 border-chart-3/30",
  final: "bg-chart-4/20 text-chart-4 border-chart-4/30",
};

export function RunQuickView({ open, onOpenChange, runId, runName, datasetName, metric, workspaceId }: RunQuickViewProps) {
  const [selectedPartitions, setSelectedPartitions] = useState<Set<string>>(new Set(["val", "test"]));

  const { data: distribution } = useQuery({
    queryKey: ["score-distribution", workspaceId, runId, datasetName],
    queryFn: () => getScoreDistribution(workspaceId, runId, datasetName),
    enabled: open && !!workspaceId,
    staleTime: 60000,
  });

  const { data: predictionsData } = useQuery({
    queryKey: ["aggregated-predictions", runId, datasetName],
    queryFn: () => getAggregatedPredictions({ run_id: runId, dataset_name: datasetName }),
    enabled: open,
    staleTime: 60000,
  });

  const predictions = predictionsData?.predictions || [];

  // Only show partition buttons for partitions that have data
  const availablePartitions = useMemo(() => {
    if (!distribution?.partitions) return ["val", "test"] as string[];
    return PARTITIONS.filter((p) => distribution.partitions[p]?.n_scores > 0);
  }, [distribution]);

  const togglePartition = (part: string) => {
    setSelectedPartitions((prev) => {
      const next = new Set(prev);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  };

  // Summary stats for selected partitions
  const partitionStats = useMemo(() => {
    if (!distribution?.partitions) return null;
    const stats: Record<string, { mean: number; min: number; max: number; n: number }> = {};
    for (const part of availablePartitions) {
      const pd = distribution.partitions[part];
      if (pd) stats[part] = { mean: pd.mean, min: pd.min, max: pd.max, n: pd.n_scores };
    }
    return Object.keys(stats).length > 0 ? stats : null;
  }, [distribution, availablePartitions]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader className="shrink-0">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <SheetTitle>{datasetName}</SheetTitle>
          </div>
          <SheetDescription>
            {runName} {metric && `\u2022 ${metric.toUpperCase()}`}
          </SheetDescription>
        </SheetHeader>

        <Separator className="my-3" />

        <ScrollArea className="flex-1">
          <div className="space-y-4 pr-4">
            {/* Partition filter — only show partitions that have data */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Partitions:</span>
              {availablePartitions.map((part) => {
                const isActive = selectedPartitions.has(part);
                return (
                  <Button
                    key={part}
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className={cn("text-xs h-7 gap-1", isActive && PARTITION_COLORS[part])}
                    onClick={() => togglePartition(part)}
                  >
                    {isActive && <Check className="h-3 w-3" />}
                    {PARTITION_LABELS[part]}
                  </Button>
                );
              })}
            </div>

            {/* Score summary per partition */}
            {partitionStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {availablePartitions.filter((p) => selectedPartitions.has(p) && partitionStats[p]).map((part) => (
                  <div key={part} className={cn("rounded-lg border p-2 text-center", PARTITION_COLORS[part])}>
                    <p className="text-[10px] uppercase font-medium mb-0.5">{PARTITION_LABELS[part]}</p>
                    <p className="text-lg font-bold font-mono">{partitionStats[part].mean.toFixed(4)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {partitionStats[part].min.toFixed(3)} – {partitionStats[part].max.toFixed(3)} ({partitionStats[part].n})
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Score histogram */}
            <div className="rounded-lg border p-3">
              <h4 className="text-sm font-medium mb-2">Score Distribution</h4>
              <ScoreHistogram
                distribution={distribution ?? null}
                selectedPartitions={selectedPartitions}
              />
            </div>

            {/* Predictions table */}
            <div className="rounded-lg border overflow-hidden">
              <h4 className="text-sm font-medium p-3 bg-muted/30 border-b">Chain Summaries</h4>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20">
                    <TableHead className="text-xs">Model</TableHead>
                    <TableHead className="text-xs">Preprocessing</TableHead>
                    <TableHead className="text-xs text-right">CV Val</TableHead>
                    <TableHead className="text-xs text-right">CV Test</TableHead>
                    <TableHead className="text-xs text-right">Folds</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {predictions.map((pred, i) => (
                    <TableRow key={pred.chain_id || i}>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="font-mono text-xs">
                          {pred.model_name ?? pred.model_class}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]">
                        {pred.preprocessings || "-"}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono text-chart-1">
                        {pred.cv_val_score != null ? pred.cv_val_score.toFixed(4) : "-"}
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono text-muted-foreground">
                        {pred.cv_test_score != null ? pred.cv_test_score.toFixed(4) : "-"}
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {pred.cv_fold_count ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {predictions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">
                        No predictions available
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
