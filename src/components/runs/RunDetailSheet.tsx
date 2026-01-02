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
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertCircle,
  Pause,
  Database,
  Layers,
  Box,
  Settings2,
  BarChart3,
  Download,
  ChevronRight,
  Terminal,
  Wrench,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Run,
  DatasetRun,
  PipelineRun,
  RunStatus,
  runStatusConfig,
} from "@/types/runs";

interface RunDetailSheetProps {
  run: Run | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusIcons = {
  queued: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: AlertCircle,
  paused: Pause,
};

const StatusIcon = ({ status }: { status: RunStatus }) => {
  const Icon = statusIcons[status];
  const config = runStatusConfig[status];
  return (
    <Icon className={cn("h-4 w-4", config.color, config.iconClass)} />
  );
};

// Mock detailed data
const getMockConfig = (pipeline: PipelineRun) => ({
  preprocessing: {
    method: pipeline.preprocessing,
    window_size: 15,
    polynomial: 2,
    derivative: 1,
  },
  model: {
    type: pipeline.model,
    n_components: 10,
    max_iter: 500,
    tol: 1e-6,
    cv: 5,
  },
  split: {
    strategy: pipeline.split_strategy,
    test_size: 0.2,
    shuffle: true,
    random_state: 42,
  },
});

const getMockLogs = (pipeline: PipelineRun): string[] => {
  if (pipeline.status === "queued") return ["[INFO] Waiting in queue..."];
  if (pipeline.status === "failed") {
    return [
      "[INFO] Starting pipeline execution...",
      "[INFO] Loading dataset...",
      "[INFO] Dataset loaded: 250 samples, 1024 features",
      "[INFO] Applying SNV preprocessing...",
      "[ERROR] Failed to process spectrum at index 142",
      "[ERROR] ValueError: Invalid spectrum values detected",
      "[ERROR] Pipeline execution failed",
    ];
  }
  return [
    "[INFO] Starting pipeline execution...",
    "[INFO] Loading dataset...",
    "[INFO] Dataset loaded: 250 samples, 1024 features",
    `[INFO] Applying ${pipeline.preprocessing} preprocessing...`,
    "[INFO] Preprocessing complete",
    `[INFO] Training ${pipeline.model} model...`,
    `[INFO] Using ${pipeline.split_strategy} validation strategy`,
    "[INFO] Model training complete",
    pipeline.status === "running"
      ? `[INFO] Cross-validation in progress... ${pipeline.progress}%`
      : `[INFO] Final R² score: ${pipeline.metrics?.r2?.toFixed(4)}`,
  ];
};

export function RunDetailSheet({ run, open, onOpenChange }: RunDetailSheetProps) {
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineRun | null>(null);
  const [groupBy, setGroupBy] = useState<"model" | "preprocessing" | "split_strategy">("model");

  if (!run) return null;

  const allPipelines = run.datasets.flatMap((d) =>
    d.pipelines.map((p) => ({ ...p, dataset: d.dataset_name }))
  );

  const completedPipelines = allPipelines.filter((p) => p.status === "completed");
  const runningPipelines = allPipelines.filter((p) => p.status === "running");
  const failedPipelines = allPipelines.filter((p) => p.status === "failed");

  // Group pipelines by selected dimension
  const groupedPipelines = allPipelines.reduce((acc, p) => {
    const key = p[groupBy];
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {} as Record<string, (PipelineRun & { dataset: string })[]>);

  const totalProgress =
    allPipelines.reduce((acc, p) => acc + p.progress, 0) / allPipelines.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", runStatusConfig[run.status].bg)}>
                <StatusIcon status={run.status} />
              </div>
              <div>
                <SheetTitle className="text-lg">{run.name}</SheetTitle>
                <SheetDescription className="flex items-center gap-2 mt-1">
                  <span>{run.started_at || run.created_at}</span>
                  {run.duration && (
                    <>
                      <span>•</span>
                      <span>{run.duration}</span>
                    </>
                  )}
                </SheetDescription>
              </div>
            </div>
            <Badge variant={run.status === "completed" ? "default" : "secondary"}>
              {runStatusConfig[run.status].label}
            </Badge>
          </div>

          {/* Progress bar for running */}
          {run.status === "running" && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Overall Progress</span>
                <span className="font-medium">{Math.round(totalProgress)}%</span>
              </div>
              <Progress value={totalProgress} className="h-2" />
            </div>
          )}

          {/* Quick Stats */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <Database className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-lg font-semibold">{run.datasets.length}</p>
              <p className="text-xs text-muted-foreground">Datasets</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <Layers className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-lg font-semibold">{allPipelines.length}</p>
              <p className="text-xs text-muted-foreground">Pipelines</p>
            </div>
            <div className="p-3 rounded-lg bg-chart-1/10 text-center">
              <CheckCircle2 className="h-4 w-4 mx-auto text-chart-1 mb-1" />
              <p className="text-lg font-semibold">{completedPipelines.length}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </div>
            <div className="p-3 rounded-lg bg-destructive/10 text-center">
              <AlertCircle className="h-4 w-4 mx-auto text-destructive mb-1" />
              <p className="text-lg font-semibold">{failedPipelines.length}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </div>
          </div>
        </SheetHeader>

        <Separator className="my-4" />

        <Tabs defaultValue="results" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-4 flex-shrink-0">
            <TabsTrigger value="results" className="text-xs">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              Results
            </TabsTrigger>
            <TabsTrigger value="config" className="text-xs">
              <Settings2 className="h-3.5 w-3.5 mr-1.5" />
              Config
            </TabsTrigger>
            <TabsTrigger value="logs" className="text-xs">
              <Terminal className="h-3.5 w-3.5 mr-1.5" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="datasets" className="text-xs">
              <Database className="h-3.5 w-3.5 mr-1.5" />
              Datasets
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            {/* Results Tab */}
            <TabsContent value="results" className="m-0 space-y-4">
              {/* Group By Selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Group by:</span>
                <div className="flex gap-1">
                  {(["model", "preprocessing", "split_strategy"] as const).map((g) => (
                    <Button
                      key={g}
                      variant={groupBy === g ? "default" : "outline"}
                      size="sm"
                      onClick={() => setGroupBy(g)}
                      className="text-xs capitalize"
                    >
                      {g === "split_strategy" ? "split" : g}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Grouped Results */}
              {Object.entries(groupedPipelines).map(([group, pipelines]) => (
                <div key={group} className="space-y-2">
                  <div className="flex items-center gap-2">
                    {groupBy === "model" && <Box className="h-4 w-4 text-primary" />}
                    {groupBy === "preprocessing" && <Wrench className="h-4 w-4 text-primary" />}
                    {groupBy === "split_strategy" && <GitBranch className="h-4 w-4 text-primary" />}
                    <h4 className="font-medium text-sm">{group}</h4>
                    <Badge variant="secondary" className="text-xs">
                      {pipelines.length} pipelines
                    </Badge>
                  </div>

                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs">Dataset</TableHead>
                          <TableHead className="text-xs">Pipeline</TableHead>
                          <TableHead className="text-xs text-right">R²</TableHead>
                          <TableHead className="text-xs text-right">RMSE</TableHead>
                          <TableHead className="text-xs"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pipelines.map((p) => (
                          <TableRow
                            key={p.id}
                            className={cn(
                              "cursor-pointer hover:bg-muted/30",
                              selectedPipeline?.id === p.id && "bg-primary/5"
                            )}
                            onClick={() => setSelectedPipeline(p)}
                          >
                            <TableCell>
                              <StatusIcon status={p.status} />
                            </TableCell>
                            <TableCell className="text-xs font-mono">{p.dataset}</TableCell>
                            <TableCell>
                              <code className="text-xs bg-accent px-1 py-0.5 rounded">
                                {p.pipeline_name}
                              </code>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {p.metrics?.r2?.toFixed(3) ?? "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {p.metrics?.rmse?.toFixed(3) ?? "-"}
                            </TableCell>
                            <TableCell>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}

              {/* Best Results Summary */}
              {completedPipelines.length > 0 && (
                <div className="p-4 rounded-lg border bg-chart-1/5 border-chart-1/20">
                  <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-chart-1" />
                    Best Results
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Highest R²</p>
                      {(() => {
                        const best = completedPipelines.reduce((a, b) =>
                          (a.metrics?.r2 ?? 0) > (b.metrics?.r2 ?? 0) ? a : b
                        );
                        return (
                          <div className="flex items-baseline gap-2">
                            <span className="text-xl font-bold text-chart-1">
                              {best.metrics?.r2?.toFixed(4)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {best.pipeline_name}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Lowest RMSE</p>
                      {(() => {
                        const best = completedPipelines.reduce((a, b) =>
                          (a.metrics?.rmse ?? Infinity) < (b.metrics?.rmse ?? Infinity) ? a : b
                        );
                        return (
                          <div className="flex items-baseline gap-2">
                            <span className="text-xl font-bold text-chart-2">
                              {best.metrics?.rmse?.toFixed(4)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {best.pipeline_name}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" asChild>
                  <Link to="/results">
                    <BarChart3 className="h-4 w-4 mr-2" />
                    View Full Results
                  </Link>
                </Button>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </div>
            </TabsContent>

            {/* Config Tab */}
            <TabsContent value="config" className="m-0 space-y-4">
              {selectedPipeline ? (
                <PipelineConfigView pipeline={selectedPipeline} />
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Settings2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Select a pipeline from Results tab to view configuration</p>
                </div>
              )}
            </TabsContent>

            {/* Logs Tab */}
            <TabsContent value="logs" className="m-0 space-y-4">
              {selectedPipeline ? (
                <PipelineLogsView pipeline={selectedPipeline} />
              ) : runningPipelines.length > 0 ? (
                <PipelineLogsView pipeline={runningPipelines[0]} />
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Terminal className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Select a pipeline to view logs</p>
                </div>
              )}
            </TabsContent>

            {/* Datasets Tab */}
            <TabsContent value="datasets" className="m-0 space-y-3">
              {run.datasets.map((d) => (
                <DatasetSummaryCard
                  key={d.dataset_id}
                  datasetRun={d}
                  isSelected={selectedDataset === d.dataset_id}
                  onSelect={() => setSelectedDataset(d.dataset_id)}
                />
              ))}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function PipelineConfigView({ pipeline }: { pipeline: PipelineRun }) {
  const config = getMockConfig(pipeline);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <code className="text-sm bg-accent px-2 py-1 rounded">{pipeline.pipeline_name}</code>
        <StatusIcon status={pipeline.status} />
      </div>

      {/* Preprocessing Config */}
      <ConfigSection
        title="Preprocessing"
        icon={<Wrench className="h-4 w-4" />}
        config={config.preprocessing}
      />

      {/* Model Config */}
      <ConfigSection
        title="Model"
        icon={<Box className="h-4 w-4" />}
        config={config.model}
      />

      {/* Split Config */}
      <ConfigSection
        title="Split Strategy"
        icon={<GitBranch className="h-4 w-4" />}
        config={config.split}
      />
    </div>
  );
}

function ConfigSection({
  title,
  icon,
  config,
}: {
  title: string;
  icon: React.ReactNode;
  config: Record<string, unknown>;
}) {
  return (
    <div className="rounded-lg border">
      <div className="p-3 bg-muted/30 border-b flex items-center gap-2">
        {icon}
        <h4 className="font-medium text-sm">{title}</h4>
      </div>
      <div className="p-3 space-y-2">
        {Object.entries(config).map(([key, value]) => (
          <div key={key} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{key}</span>
            <code className="text-xs bg-accent px-1.5 py-0.5 rounded">
              {String(value)}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineLogsView({ pipeline }: { pipeline: PipelineRun }) {
  const logs = getMockLogs(pipeline);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <code className="text-sm bg-accent px-2 py-1 rounded">{pipeline.pipeline_name}</code>
          <StatusIcon status={pipeline.status} />
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download
        </Button>
      </div>

      <div className="rounded-lg border bg-muted/20 p-4 font-mono text-xs space-y-1 max-h-80 overflow-auto">
        {logs.map((log, i) => (
          <div
            key={i}
            className={cn(
              log.includes("[ERROR]") && "text-destructive",
              log.includes("[INFO]") && "text-muted-foreground"
            )}
          >
            {log}
          </div>
        ))}
        {pipeline.status === "running" && (
          <div className="flex items-center gap-2 text-chart-2">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>Processing...</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DatasetSummaryCard({
  datasetRun,
  isSelected,
  onSelect,
}: {
  datasetRun: DatasetRun;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const completed = datasetRun.pipelines.filter((p) => p.status === "completed");
  const models = new Set(datasetRun.pipelines.map((p) => p.model));
  const preprocessings = new Set(datasetRun.pipelines.map((p) => p.preprocessing));

  const bestR2 = completed.length
    ? Math.max(...completed.map((p) => p.metrics?.r2 ?? 0))
    : null;

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
          <span className="font-medium text-sm">{datasetRun.dataset_name}</span>
        </div>
        {bestR2 && (
          <Badge variant="outline" className="text-chart-1 border-chart-1/30">
            Best R² {bestR2.toFixed(3)}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-lg font-semibold">{datasetRun.pipelines.length}</p>
          <p className="text-xs text-muted-foreground">Pipelines</p>
        </div>
        <div>
          <p className="text-lg font-semibold">{models.size}</p>
          <p className="text-xs text-muted-foreground">Models</p>
        </div>
        <div>
          <p className="text-lg font-semibold">{preprocessings.size}</p>
          <p className="text-xs text-muted-foreground">Preprocessings</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mt-3">
        {Array.from(models).map((m) => (
          <Badge key={m} variant="secondary" className="text-xs">
            {m}
          </Badge>
        ))}
        {Array.from(preprocessings).map((p) => (
          <Badge key={p} variant="outline" className="text-xs">
            {p}
          </Badge>
        ))}
      </div>
    </div>
  );
}
