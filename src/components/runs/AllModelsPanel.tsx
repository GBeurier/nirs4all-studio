/**
 * AllModelsPanel — Lazy-loaded, sortable table of ALL chain summaries
 * for a run+dataset. Includes global scores and inline per-fold rows.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowDown, ArrowUp, ArrowUpDown, Award, ChevronDown, ChevronRight, Eye, Loader2,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { formatMetricValue, isLowerBetter } from "@/lib/scores";
import { getAllChainsForDataset, getChainPartitionDetail } from "@/api/client";
import type { PartitionPrediction } from "@/types/aggregated-predictions";
import type { AllChainEntry } from "@/types/enriched-runs";
import { ChainDetailSheet } from "@/components/predictions/ChainDetailSheet";
import { PredictionViewer } from "@/components/predictions/viewer/PredictionViewer";
import type {
  ChainDetailFocus,
  ChainDetailMetaHint,
} from "@/components/predictions/detail/ChainDetailPanel";
import type {
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";

interface AllModelsPanelProps {
  workspaceId: string;
  runId: string;
  datasetName: string;
  taskType: string | null;
  totalPipelines: number;
}

type SortColumn = "cv_val_score" | "cv_test_score" | "cv_train_score" | "final_test_score" | "final_train_score";
type SortDir = "asc" | "desc";

function formatParam(k: string, v: unknown): string {
  if (typeof v === "number") {
    if (Number.isInteger(v)) return `${k}=${v}`;
    return `${k}=${v.toPrecision(4)}`;
  }
  return `${k}=${String(v)}`;
}

function partitionBadgeClass(partition: string): string {
  if (partition === "val") return "bg-chart-1/20 text-chart-1 border-chart-1/30";
  if (partition === "test") return "bg-chart-2/20 text-chart-2 border-chart-2/30";
  if (partition === "train") return "bg-chart-3/20 text-chart-3 border-chart-3/30";
  return "bg-muted text-muted-foreground border-border";
}

function foldSortValue(foldId: string): number {
  if (foldId.toLowerCase() === "final") return Number.MAX_SAFE_INTEGER;
  const parsed = Number(foldId.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER - 1;
}

function partitionSortValue(partition: string): number {
  if (partition === "train") return 0;
  if (partition === "val") return 1;
  if (partition === "test") return 2;
  return 3;
}

function ModelFoldRows({ chainId, metric }: { chainId: string; metric: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["chain-fold-scores", chainId],
    queryFn: () => getChainPartitionDetail(chainId),
    staleTime: 60000,
  });

  const rows = useMemo(() => {
    const allRows = data?.predictions || [];
    return [...allRows].sort((a, b) => {
      const foldDelta = foldSortValue(a.fold_id) - foldSortValue(b.fold_id);
      if (foldDelta !== 0) return foldDelta;
      return partitionSortValue(a.partition) - partitionSortValue(b.partition);
    });
  }, [data?.predictions]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground ml-2">Loading fold scores...</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        No fold-level scores available for this model.
      </div>
    );
  }

  const folds = Array.from(new Set(rows.map(r => r.fold_id))).sort((a, b) => foldSortValue(a) - foldSortValue(b));

  return (
    <div className="rounded-lg border bg-background">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground font-medium border-b">
        Per-fold scores (train / val / test)
      </div>
      <ScrollArea className="max-h-96">
        <div className="p-3 space-y-4">
          {folds.map(foldId => {
            const foldRows = rows.filter(r => r.fold_id === foldId);
            return (
              <div key={foldId} className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">
                  {foldId.toLowerCase() === "final" ? "Refit" : `Fold ${foldId}`}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {["train", "val", "test"].map(partition => {
                    const row = foldRows.find(r => r.partition === partition);
                    if (!row) return <div key={partition} className="border rounded p-2 bg-muted/5 border-dashed opacity-50 flex items-center justify-center text-[10px] text-muted-foreground">No {partition} data</div>;

                    return (
                      <div key={partition} className="border rounded p-2 bg-muted/10 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 uppercase", partitionBadgeClass(partition))}>
                            {partition}
                          </Badge>
                          {row.best_params && Object.keys(row.best_params).length > 0 && (
                            <div className="text-[9px] text-muted-foreground truncate max-w-[140px]" title={JSON.stringify(row.best_params)}>
                              {Object.entries(row.best_params).map(([k, v]) => formatParam(k, v)).join(", ")}
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                          {row.scores ? (
                            Object.entries(row.scores).map(([k, v]) => (
                              <div key={k} className="flex justify-between items-center border-b border-border/50 pb-0.5 last:border-0">
                                <span className="text-muted-foreground/80 uppercase">{k}</span>
                                <span className={cn("font-mono font-medium", k.toLowerCase() === metric.toLowerCase() && "text-foreground font-bold")}>
                                  {formatMetricValue(v as number, k)}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="flex justify-between items-center border-b border-border/50 pb-0.5">
                              <span className="text-muted-foreground/80 uppercase">{metric}</span>
                              <span className="font-mono font-bold">
                                {formatMetricValue(row[`${partition}_score`] as number, metric)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

export function AllModelsPanel({ workspaceId, runId, datasetName, taskType, totalPipelines }: AllModelsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [sortCol, setSortCol] = useState<SortColumn>("cv_val_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedChainId, setExpandedChainId] = useState<string | null>(null);
  const [detailChainId, setDetailChainId] = useState<string | null>(null);
  const [detailMetaHint, setDetailMetaHint] = useState<ChainDetailMetaHint | undefined>(undefined);
  const [detailFocus, setDetailFocus] = useState<ChainDetailFocus | undefined>(undefined);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailViewerHeader, setDetailViewerHeader] = useState<ViewerHeader | null>(null);
  const [detailViewerPartitions, setDetailViewerPartitions] = useState<ViewerPartitionTarget[]>([]);
  const [detailViewerKind, setDetailViewerKind] = useState<ChartKind | undefined>(undefined);
  const [detailViewerOpen, setDetailViewerOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["all-chains", workspaceId, runId, datasetName],
    queryFn: () => getAllChainsForDataset(workspaceId, runId, datasetName),
    enabled: expanded && !!workspaceId,
    staleTime: 60000,
  });

  const metric = data?.metric || "r2";
  const metricLowerIsBetter = isLowerBetter(metric);

  const initialSortApplied = useRef(false);
  useEffect(() => {
    if (data?.metric && !initialSortApplied.current) {
      initialSortApplied.current = true;
      if (isLowerBetter(data.metric)) {
        setSortDir("asc");
      }
    }
  }, [data?.metric]);

  const sorted = useMemo(() => {
    const chains = data?.chains || [];
    if (chains.length === 0) return [];
    const arr = [...chains];
    const dir = sortDir === "desc" ? -1 : 1;
    arr.sort((a, b) => {
      const av = a[sortCol] ?? (dir > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
      const bv = b[sortCol] ?? (dir > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
      return (av as number - (bv as number)) * dir;
    });
    return arr;
  }, [data?.chains, sortCol, sortDir]);

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortCol(col);
    setSortDir(metricLowerIsBetter ? "asc" : "desc");
  };

  const openDetail = (chain: AllChainEntry) => {
    setDetailChainId(chain.chain_id);
    setDetailMetaHint({
      modelName: chain.model_name,
      modelClass: chain.model_class,
      datasetName,
      metric: chain.metric,
      taskType: taskType ?? chain.task_type,
      preprocessings: chain.preprocessings,
    });
    setDetailFocus({
      cardType: chain.final_test_score != null ? "refit" : "crossval",
      foldId: chain.final_test_score != null ? "final" : "avg",
    });
    setDetailOpen(true);
  };

  const toggleFoldRows = (chainId: string) => {
    setExpandedChainId((prev) => (prev === chainId ? null : chainId));
  };

  const loadedModelCount = data?.total ?? 0;
  const expectedModelCount = totalPipelines > 0 ? totalPipelines : loadedModelCount;
  const missingModels = Math.max(expectedModelCount - loadedModelCount, 0);

  const SortIcon = ({ col }: { col: SortColumn }) => {
    if (sortCol !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  return (
    <>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-1.5 px-1 py-1.5 cursor-pointer hover:bg-muted/30 rounded text-xs text-muted-foreground transition-colors">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span className="font-medium">
              {expanded && data ? `All ${loadedModelCount} models` : "Show all trained models"}
            </span>
            {!expanded && expectedModelCount > 0 && (
              <Badge variant="outline" className="text-[10px] ml-1">{expectedModelCount} expected</Badge>
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground ml-2">Loading all models...</span>
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">
              No models found
            </div>
          ) : (
            <div className="mt-1 rounded-lg border overflow-hidden" data-testid="all-models-table">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-[10px] w-8" />
                      <TableHead className="text-[10px] w-8">#</TableHead>
                      <TableHead className="text-[10px]">Model</TableHead>
                      <TableHead className="text-[10px]">Preprocessing</TableHead>
                      <TableHead className="text-[10px]">Params</TableHead>
                      <TableHead className="text-[10px] text-right cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort("cv_val_score")}>
                        CV Val <SortIcon col="cv_val_score" />
                      </TableHead>
                      <TableHead className="text-[10px] text-right cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort("cv_test_score")}>
                        CV Test <SortIcon col="cv_test_score" />
                      </TableHead>
                      <TableHead className="text-[10px] text-right cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort("cv_train_score")}>
                        CV Train <SortIcon col="cv_train_score" />
                      </TableHead>
                      <TableHead className="text-[10px] text-right cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort("final_test_score")}>
                        Refit Test <SortIcon col="final_test_score" />
                      </TableHead>
                      <TableHead className="text-[10px] text-right cursor-pointer select-none whitespace-nowrap" onClick={() => handleSort("final_train_score")}>
                        Refit Train <SortIcon col="final_train_score" />
                      </TableHead>
                      <TableHead className="text-[10px] text-center w-12">Folds</TableHead>
                      <TableHead className="text-[10px] w-16">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((chain, idx) => {
                      const hasFinal = chain.final_test_score != null;
                      const isFirst = idx === 0;
                      const rowExpanded = expandedChainId === chain.chain_id;

                      return (
                        <Fragment key={chain.chain_id}>
                          <TableRow
                            className={cn(
                              "transition-colors hover:bg-muted/20",
                              hasFinal && "bg-emerald-500/[0.03]",
                              isFirst && (hasFinal ? "bg-emerald-500/[0.06]" : "bg-chart-1/[0.04]"),
                            )}
                          >
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => toggleFoldRows(chain.chain_id)}
                                title="Toggle fold scores"
                              >
                                {rowExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              </Button>
                            </TableCell>
                            <TableCell className="text-xs">
                              <span className={cn(
                                "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                                isFirst ? (hasFinal ? "bg-emerald-500/20 text-emerald-600" : "bg-chart-1/20 text-chart-1") : "text-muted-foreground",
                              )}>
                                {idx + 1}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="flex items-center gap-1">
                                {hasFinal && <Award className="h-3 w-3 text-emerald-500 shrink-0" />}
                                <span className="font-mono font-medium truncate max-w-[120px]">{chain.model_name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground truncate max-w-[170px]" title={chain.preprocessings}>
                              {chain.preprocessings || "\u2014"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {chain.best_params && Object.keys(chain.best_params).length > 0 ? (
                                <div className="flex flex-wrap gap-0.5">
                                  {Object.entries(chain.best_params).slice(0, 2).map(([k, v]) => (
                                    <Badge key={k} variant="secondary" className="text-[9px] font-mono px-1 py-0">
                                      {formatParam(k, v)}
                                    </Badge>
                                  ))}
                                  {Object.keys(chain.best_params).length > 2 && (
                                    <Badge variant="secondary" className="text-[9px] px-1 py-0">+{Object.keys(chain.best_params).length - 2}</Badge>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground/50">\u2014</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono">
                              <span className={cn(isFirst && "font-bold text-chart-1")}>
                                {formatMetricValue(chain.cv_val_score, metric)}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono text-muted-foreground">
                              {formatMetricValue(chain.cv_test_score, metric)}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono text-muted-foreground/70">
                              {formatMetricValue(chain.cv_train_score, metric)}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono">
                              {hasFinal ? (
                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                  {formatMetricValue(chain.final_test_score, metric)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/50">\u2014</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono text-muted-foreground/70">
                              {formatMetricValue(chain.final_train_score, metric)}
                            </TableCell>
                            <TableCell className="text-xs text-center text-muted-foreground">
                              {chain.cv_fold_count || "\u2014"}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => openDetail(chain)}
                                title="Open model details"
                              >
                                <Eye className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          </TableRow>

                          {rowExpanded && (
                            <TableRow>
                              <TableCell colSpan={12} className="bg-muted/10 px-3 py-2">
                                <ModelFoldRows chainId={chain.chain_id} metric={metric} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="px-3 py-1.5 bg-muted/20 border-t text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
                <span>{loadedModelCount} model{loadedModelCount !== 1 ? "s" : ""} loaded</span>
                <span>·</span>
                <span>{sorted.filter((c) => c.final_test_score != null).length} refitted</span>
                <span>·</span>
                <span>{`sorted by ${sortCol.replace(/_/g, " ")} ${sortDir}`}</span>
                {expectedModelCount > loadedModelCount && (
                  <>
                    <span>·</span>
                    <span className="text-amber-600">{missingModels} missing from expected count</span>
                  </>
                )}
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <ChainDetailSheet
        chainId={detailChainId}
        metric={detailMetaHint?.metric ?? null}
        metaHint={detailMetaHint}
        focus={detailFocus}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        isViewerOpen={detailViewerOpen}
        onOpenViewer={(partitions, header, kind) => {
          setDetailViewerPartitions(partitions);
          setDetailViewerHeader(header);
          setDetailViewerKind(kind);
          setDetailViewerOpen(true);
        }}
      />

      {detailViewerHeader && (
        <PredictionViewer
          open={detailViewerOpen}
          onOpenChange={setDetailViewerOpen}
          header={detailViewerHeader}
          partitions={detailViewerPartitions}
          initialKind={detailViewerKind}
        />
      )}
    </>
  );
}
