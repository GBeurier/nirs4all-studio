/**
 * ChainDetailSheet — slide-over showing chain-level prediction details.
 *
 * Displays the aggregated summary for a chain, then lists individual
 * fold/partition rows with drill-down to prediction arrays.
 */

import { useState, useEffect, Fragment } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Layers,
  BarChart3,
  Target,
  GitBranch,
  Database,
  Box,
  ChevronRight,
  ArrowUpDown,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getChainDetail, getChainPartitionDetail, getPredictionArrays } from "@/api/client";
import type {
  AggregatedPrediction,
  ChainDetailResponse,
  PartitionPrediction,
  PredictionArraysResponse,
} from "@/types/aggregated-predictions";

interface ChainDetailSheetProps {
  /** Pre-loaded aggregated row (from the list page). */
  prediction: AggregatedPrediction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatScore(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toFixed(4);
}

function ScoreCell({ value, best }: { value: number | null | undefined; best?: boolean }) {
  return (
    <span className={cn("tabular-nums", best && "font-semibold text-primary")}>
      {formatScore(value)}
    </span>
  );
}

function PartitionBadge({ partition }: { partition: string }) {
  const colors: Record<string, string> = {
    val: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    test: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    train: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  };
  return (
    <Badge variant="outline" className={cn("text-xs", colors[partition])}>
      {partition}
    </Badge>
  );
}

export function ChainDetailSheet({ prediction, open, onOpenChange }: ChainDetailSheetProps) {
  const [detail, setDetail] = useState<ChainDetailResponse | null>(null);
  const [partitionRows, setPartitionRows] = useState<PartitionPrediction[]>([]);
  const [partitionFilter, setPartitionFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [arrayData, setArrayData] = useState<PredictionArraysResponse | null>(null);
  const [loadingArrays, setLoadingArrays] = useState(false);
  const [selectedPredictionId, setSelectedPredictionId] = useState<string | null>(null);

  // Load chain detail when opened
  useEffect(() => {
    if (!open || !prediction) {
      setDetail(null);
      setPartitionRows([]);
      setArrayData(null);
      setSelectedPredictionId(null);
      return;
    }

    async function load() {
      if (!prediction) return;
      setLoading(true);
      try {
        const [chainDetail, partitions] = await Promise.all([
          getChainDetail(prediction.chain_id, { metric: prediction.metric }),
          getChainPartitionDetail(prediction.chain_id),
        ]);
        setDetail(chainDetail);
        setPartitionRows(partitions.predictions);
      } catch (err) {
        console.error("Failed to load chain detail:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [open, prediction]);

  // Load arrays for selected prediction
  useEffect(() => {
    if (!selectedPredictionId) {
      setArrayData(null);
      return;
    }
    async function loadArrays() {
      if (!selectedPredictionId) return;
      setLoadingArrays(true);
      try {
        const data = await getPredictionArrays(selectedPredictionId);
        setArrayData(data);
      } catch {
        setArrayData(null);
      } finally {
        setLoadingArrays(false);
      }
    }
    loadArrays();
  }, [selectedPredictionId]);

  // Filter partition rows
  const filteredRows = partitionFilter === "all"
    ? partitionRows
    : partitionRows.filter((r) => r.partition === partitionFilter);

  if (!prediction) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl w-full overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Box className="h-5 w-5 text-muted-foreground" />
            {prediction.model_name}
          </SheetTitle>
          <SheetDescription>
            Chain detail — {prediction.metric} on {prediction.dataset_name}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="summary" className="mt-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="folds">Folds</TabsTrigger>
            <TabsTrigger value="arrays">Arrays</TabsTrigger>
          </TabsList>

          {/* ===== Summary tab ===== */}
          <TabsContent value="summary" className="space-y-4 mt-4">
            {/* Chain identity */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <GitBranch className="h-4 w-4" /> Chain Identity
              </h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">Model</div>
                <div className="font-medium">{prediction.model_name}</div>
                <div className="text-muted-foreground">Class</div>
                <div>{prediction.model_class}</div>
                <div className="text-muted-foreground">Preprocessing</div>
                <div>{prediction.preprocessings || "None"}</div>
                <div className="text-muted-foreground">Dataset</div>
                <div className="flex items-center gap-1">
                  <Database className="h-3 w-3" /> {prediction.dataset_name}
                </div>
                <div className="text-muted-foreground">Metric</div>
                <div>
                  <Badge variant="secondary">{prediction.metric}</Badge>
                </div>
              </div>
            </div>

            <Separator />

            {/* Score summary */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> Scores
              </h4>
              <div className="grid grid-cols-4 gap-1 text-xs">
                <div className="font-medium text-muted-foreground">Partition</div>
                <div className="font-medium text-muted-foreground text-right">Min</div>
                <div className="font-medium text-muted-foreground text-right">Avg</div>
                <div className="font-medium text-muted-foreground text-right">Max</div>

                {prediction.partitions.includes("val") && (
                  <>
                    <div><PartitionBadge partition="val" /></div>
                    <div className="text-right"><ScoreCell value={prediction.min_val_score} /></div>
                    <div className="text-right"><ScoreCell value={prediction.avg_val_score} best /></div>
                    <div className="text-right"><ScoreCell value={prediction.max_val_score} /></div>
                  </>
                )}
                {prediction.partitions.includes("test") && (
                  <>
                    <div><PartitionBadge partition="test" /></div>
                    <div className="text-right"><ScoreCell value={prediction.min_test_score} /></div>
                    <div className="text-right"><ScoreCell value={prediction.avg_test_score} best /></div>
                    <div className="text-right"><ScoreCell value={prediction.max_test_score} /></div>
                  </>
                )}
                {prediction.partitions.includes("train") && (
                  <>
                    <div><PartitionBadge partition="train" /></div>
                    <div className="text-right"><ScoreCell value={prediction.min_train_score} /></div>
                    <div className="text-right"><ScoreCell value={prediction.avg_train_score} best /></div>
                    <div className="text-right"><ScoreCell value={prediction.max_train_score} /></div>
                  </>
                )}
              </div>
            </div>

            <Separator />

            {/* Fold/partition counts */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Layers className="h-4 w-4" /> Configuration
              </h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">Folds</div>
                <div>{prediction.fold_count}</div>
                <div className="text-muted-foreground">Partitions</div>
                <div className="flex gap-1">
                  {prediction.partitions.map((p) => (
                    <PartitionBadge key={p} partition={p} />
                  ))}
                </div>
                <div className="text-muted-foreground">Total predictions</div>
                <div>{prediction.prediction_ids.length}</div>
              </div>
            </div>

            {/* Pipeline info if available */}
            {detail?.pipeline && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Target className="h-4 w-4" /> Pipeline
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-muted-foreground">Name</div>
                    <div>{detail.pipeline.name || "—"}</div>
                    <div className="text-muted-foreground">Status</div>
                    <div>
                      <Badge variant={detail.pipeline.status === "completed" ? "default" : "secondary"}>
                        {detail.pipeline.status || "unknown"}
                      </Badge>
                    </div>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* ===== Folds tab ===== */}
          <TabsContent value="folds" className="space-y-3 mt-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4" /> Fold-level predictions
              </h4>
              <Select value={partitionFilter} onValueChange={setPartitionFilter}>
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="val">Val</SelectItem>
                  <SelectItem value="test">Test</SelectItem>
                  <SelectItem value="train">Train</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Fold</TableHead>
                      <TableHead className="w-16">Part.</TableHead>
                      <TableHead className="text-right">Val</TableHead>
                      <TableHead className="text-right">Test</TableHead>
                      <TableHead className="text-right">Train</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <TableRow
                        key={row.prediction_id}
                        className={cn(
                          "cursor-pointer",
                          selectedPredictionId === row.prediction_id && "bg-accent"
                        )}
                        onClick={() => setSelectedPredictionId(row.prediction_id)}
                      >
                        <TableCell className="text-xs">{row.fold_id}</TableCell>
                        <TableCell><PartitionBadge partition={row.partition} /></TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {formatScore(row.val_score)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {formatScore(row.test_score)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {formatScore(row.train_score)}
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No predictions found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </TabsContent>

          {/* ===== Arrays tab ===== */}
          <TabsContent value="arrays" className="space-y-3 mt-4">
            {!selectedPredictionId ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                Select a prediction from the Folds tab to view arrays
              </div>
            ) : loadingArrays ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !arrayData ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                No array data available for this prediction
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground">Prediction ID</div>
                  <div className="font-mono text-xs truncate">{arrayData.prediction_id}</div>
                  <div className="text-muted-foreground">Samples</div>
                  <div>{arrayData.n_samples}</div>
                  <div className="text-muted-foreground">y_true</div>
                  <div>{arrayData.y_true ? `${arrayData.y_true.length} values` : "—"}</div>
                  <div className="text-muted-foreground">y_pred</div>
                  <div>{arrayData.y_pred ? `${arrayData.y_pred.length} values` : "—"}</div>
                  {arrayData.y_proba && (
                    <>
                      <div className="text-muted-foreground">y_proba</div>
                      <div>{arrayData.y_proba.length} values</div>
                    </>
                  )}
                </div>

                {/* Simple scatter preview */}
                {arrayData.y_true && arrayData.y_pred && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Predicted vs Actual (first 50)</h4>
                      <div className="grid grid-cols-3 gap-1 text-xs font-mono max-h-[200px] overflow-y-auto">
                        <div className="font-medium text-muted-foreground sticky top-0 bg-background">
                          #
                        </div>
                        <div className="font-medium text-muted-foreground sticky top-0 bg-background">
                          True
                        </div>
                        <div className="font-medium text-muted-foreground sticky top-0 bg-background">
                          Pred
                        </div>
                        {arrayData.y_true.slice(0, 50).map((yt, i) => (
                          <Fragment key={i}>
                            <div className="text-muted-foreground">{i}</div>
                            <div>{yt.toFixed(3)}</div>
                            <div>{arrayData.y_pred![i]?.toFixed(3) ?? "—"}</div>
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
