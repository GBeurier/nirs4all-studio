import { useState } from "react";
import { Link } from "react-router-dom";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertCircle,
  Pause,
  CircleDashed,
  Database,
  Layers,
  Box,
  BarChart3,
  ExternalLink,
  Target,
} from "lucide-react";
import { PredictDialog } from "./PredictDialog";
import { cn } from "@/lib/utils";
import { formatScore, formatMetricName } from "@/lib/scores";
import { RunStatus, runStatusConfig } from "@/types/runs";
import type { EnrichedRun, EnrichedDatasetRun, TopChainResult } from "@/types/enriched-runs";

interface RunDetailSheetProps {
  run: EnrichedRun | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

const statusIcons = {
  queued: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: AlertCircle,
  paused: Pause,
  partial: CircleDashed,
};

const StatusIcon = ({ status }: { status: RunStatus }) => {
  const Icon = statusIcons[status];
  const config = runStatusConfig[status];
  if (!Icon || !config) return null;
  return (
    <Icon className={cn("h-4 w-4", config.color, config.iconClass)} />
  );
};
function formatDuration(seconds: number | null): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function RunDetailSheet({ run, open, onOpenChange, workspaceId }: RunDetailSheetProps) {
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);

  // Predict dialog state
  const [predictDialogOpen, setPredictDialogOpen] = useState(false);
  const [predictChain, setPredictChain] = useState<{ chain: TopChainResult; datasetName: string } | null>(null);

  const handlePredict = (chain: TopChainResult, datasetName: string) => {
    setPredictChain({ chain, datasetName });
    setPredictDialogOpen(true);
  };

  if (!run) return null;

  const status = (run.status || "completed") as RunStatus;
  const config = runStatusConfig[status] || runStatusConfig.completed;

  // Collect all top chains across datasets for the results view
  const allChains = run.datasets.flatMap((ds) =>
    ds.top_5.map((chain) => ({ ...chain, dataset_name: ds.dataset_name, metric: ds.metric, task_type: ds.task_type }))
  );

  // Group chains by model
  const chainsByModel = allChains.reduce((acc, chain) => {
    const key = chain.model_name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(chain);
    return acc;
  }, {} as Record<string, typeof allChains>);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", config.bg)}>
                <StatusIcon status={status} />
              </div>
              <div>
                <SheetTitle className="text-lg">{run.name || run.run_id}</SheetTitle>
                <SheetDescription className="flex items-center gap-2 mt-1">
                  <span>{run.created_at ? new Date(run.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "-"}</span>
                  {run.duration_seconds != null && (
                    <>
                      <span>&bull;</span>
                      <span>{formatDuration(run.duration_seconds)}</span>
                    </>
                  )}
                </SheetDescription>
              </div>
            </div>
            <Badge variant={status === "completed" ? "default" : "secondary"}>
              {config.label}
            </Badge>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <Database className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-lg font-semibold">{run.datasets_count}</p>
              <p className="text-xs text-muted-foreground">Datasets</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <Layers className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-lg font-semibold">{run.pipeline_runs_count}</p>
              <p className="text-xs text-muted-foreground">Pipelines</p>
            </div>
            <div className="p-3 rounded-lg bg-chart-1/10 text-center">
              <Target className="h-4 w-4 mx-auto text-chart-1 mb-1" />
              <p className="text-lg font-semibold">{run.final_models_count}</p>
              <p className="text-xs text-muted-foreground">Final Models</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <Box className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-lg font-semibold">{run.total_models_trained}</p>
              <p className="text-xs text-muted-foreground">Trained</p>
            </div>
          </div>
        </SheetHeader>

        <Separator className="my-4" />

        <Tabs defaultValue="results" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
            <TabsTrigger value="results" className="text-xs">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              Results
            </TabsTrigger>
            <TabsTrigger value="datasets" className="text-xs">
              <Database className="h-3.5 w-3.5 mr-1.5" />
              Datasets
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            {/* Results Tab */}
            <TabsContent value="results" className="m-0 space-y-4">
              {allChains.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No results available yet</p>
                </div>
              ) : (
                <>
                  {/* Best Results Summary */}
                  {run.datasets.some((ds) => ds.best_final_score != null || ds.best_avg_val_score != null) && (
                    <div className="p-4 rounded-lg border bg-card">
                      <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-chart-1" />
                        Best Results
                      </h4>
                      <div className="space-y-2.5">
                        {run.datasets.filter((ds) => ds.best_final_score != null || ds.best_avg_val_score != null).map((ds) => {
                          const hasFinal = ds.best_final_score != null;
                          return (
                            <div key={ds.dataset_name} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Database className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-sm">{ds.dataset_name}</span>
                                {ds.metric && (
                                  <Badge variant="outline" className="text-[10px]">{formatMetricName(ds.metric)}</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 font-mono text-sm">
                                {hasFinal ? (
                                  <>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <span className="text-emerald-500 font-bold">{formatScore(ds.best_final_score)}</span>
                                        </TooltipTrigger>
                                        <TooltipContent>Best final test score (refit)</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    {ds.best_avg_val_score != null && (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger>
                                            <span className="text-muted-foreground text-xs">CV {formatScore(ds.best_avg_val_score)}</span>
                                          </TooltipTrigger>
                                          <TooltipContent>Best avg CV validation score</TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}
                                  </>
                                ) : (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <span className="text-chart-1 font-bold">{formatScore(ds.best_avg_val_score)}</span>
                                      </TooltipTrigger>
                                      <TooltipContent>Best avg CV validation score</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Grouped by Model */}
                  {Object.entries(chainsByModel).map(([modelName, chains]) => (
                    <div key={modelName} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Box className="h-4 w-4 text-primary" />
                        <h4 className="font-medium text-sm">{modelName}</h4>
                        <Badge variant="secondary" className="text-xs">
                          {chains.length} chains
                        </Badge>
                      </div>

                      <div className="rounded-lg border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead className="text-xs">Dataset</TableHead>
                              <TableHead className="text-xs">Preprocessing</TableHead>
                              <TableHead className="text-xs text-right">Final Test</TableHead>
                              <TableHead className="text-xs text-right">CV Val</TableHead>
                              <TableHead className="text-xs text-right">CV Test</TableHead>
                              <TableHead className="text-xs text-right">Folds</TableHead>
                              <TableHead className="text-xs">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {chains.map((chain) => {
                              const hasFinal = chain.final_test_score != null;
                              return (
                                <TableRow key={`${chain.chain_id}-${chain.dataset_name}`}>
                                  <TableCell className="text-xs font-mono">{chain.dataset_name}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]" title={chain.preprocessings}>
                                    {chain.preprocessings || "-"}
                                  </TableCell>
                                  <TableCell className={cn("text-right font-mono text-xs", hasFinal ? "text-emerald-500 font-semibold" : "text-muted-foreground")}>
                                    {hasFinal ? formatScore(chain.final_test_score) : "-"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs text-chart-1">
                                    {formatScore(chain.avg_val_score)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                    {formatScore(chain.avg_test_score)}
                                  </TableCell>
                                  <TableCell className="text-right text-xs text-muted-foreground">
                                    {chain.fold_count}
                                  </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 w-7 p-0"
                                            onClick={() => handlePredict(chain, chain.dataset_name)}
                                          >
                                            <Target className="h-3.5 w-3.5 text-primary" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>Make predictions with this model</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                                      <Link to={`/predictions?run_id=${encodeURIComponent(run.run_id)}&dataset=${encodeURIComponent(chain.dataset_name)}&model=${encodeURIComponent(chain.model_name)}`}>
                                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                                      </Link>
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ))}

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" asChild>
                      <Link to={`/results?run_id=${encodeURIComponent(run.run_id)}`}>
                        <BarChart3 className="h-4 w-4 mr-2" />
                        View Full Results
                      </Link>
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>

            {/* Datasets Tab */}
            <TabsContent value="datasets" className="m-0 space-y-3">
              {run.datasets.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No datasets available</p>
                </div>
              ) : (
                run.datasets.map((ds) => (
                  <EnrichedDatasetCard
                    key={ds.dataset_name}
                    dataset={ds}
                    isSelected={selectedDataset === ds.dataset_name}
                    onSelect={() => setSelectedDataset(ds.dataset_name)}
                    runId={run.run_id}
                  />
                ))
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        {/* Predict Dialog */}
        {predictChain && (
          <PredictDialog
            open={predictDialogOpen}
            onOpenChange={setPredictDialogOpen}
            modelId={predictChain.chain.chain_id}
            modelName={predictChain.chain.model_name}
            pipelineId={predictChain.chain.chain_id}
            pipelineName={`${predictChain.chain.model_name} (${predictChain.chain.preprocessings || "none"})`}
            runId={run.run_id}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function EnrichedDatasetCard({
  dataset,
  isSelected,
  onSelect,
  runId,
}: {
  dataset: EnrichedDatasetRun;
  isSelected: boolean;
  onSelect: () => void;
  runId: string;
}) {
  const models = new Set(dataset.top_5.map((c) => c.model_name));
  const hasFinal = dataset.best_final_score != null;

  return (
    <div
      className={cn(
        "p-4 rounded-lg border cursor-pointer transition-colors",
        isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/30"
      )}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">{dataset.dataset_name}</span>
          {dataset.task_type && (
            <Badge variant="outline" className="text-[10px]">{dataset.task_type}</Badge>
          )}
        </div>
        {(hasFinal || dataset.best_avg_val_score != null) && (
          <Badge variant="outline" className={cn(
            "font-mono",
            hasFinal
              ? "text-emerald-500 border-emerald-500/30"
              : "text-chart-1 border-chart-1/30",
          )}>
            {hasFinal ? "Final" : "CV"} {formatMetricName(dataset.metric)} {formatScore(hasFinal ? dataset.best_final_score : dataset.best_avg_val_score)}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-lg font-semibold">{dataset.pipeline_count}</p>
          <p className="text-xs text-muted-foreground">Pipelines</p>
        </div>
        <div>
          <p className="text-lg font-semibold">{models.size}</p>
          <p className="text-xs text-muted-foreground">Models</p>
        </div>
        <div>
          <p className="text-lg font-semibold">{dataset.top_5.length}</p>
          <p className="text-xs text-muted-foreground">Top Chains</p>
        </div>
      </div>

      {/* Top chain preview */}
      {dataset.top_5.length > 0 && (
        <div className="mt-3 space-y-1">
          {dataset.top_5.slice(0, 3).map((chain, i) => {
            const chainHasFinal = chain.final_test_score != null;
            return (
              <div key={chain.chain_id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn(
                    "w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                    i === 0
                      ? (chainHasFinal ? "bg-emerald-500/20 text-emerald-500" : "bg-chart-1/20 text-chart-1")
                      : "bg-muted text-muted-foreground",
                  )}>
                    {i + 1}
                  </span>
                  <span className="truncate">{chain.model_name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 font-mono">
                  {chainHasFinal ? (
                    <>
                      <span className="text-emerald-500">{formatScore(chain.final_test_score)}</span>
                      <span className="text-muted-foreground text-[10px]">CV {formatScore(chain.avg_val_score)}</span>
                    </>
                  ) : (
                    <span className="text-chart-1">{formatScore(chain.avg_val_score)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-1 mt-3">
        {Array.from(models).map((m) => (
          <Badge key={m} variant="secondary" className="text-xs">
            {m}
          </Badge>
        ))}
      </div>

      <Button variant="ghost" size="sm" className="w-full mt-2 text-xs" asChild>
        <Link to={`/predictions?run_id=${encodeURIComponent(runId)}&dataset=${encodeURIComponent(dataset.dataset_name)}`}>
          <ExternalLink className="h-3 w-3 mr-1" />
          View Predictions
        </Link>
      </Button>
    </div>
  );
}
