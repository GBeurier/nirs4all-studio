import { useState, useMemo, useEffect, useCallback } from "react";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { motion } from "@/lib/motion";
import { Link } from "react-router-dom";
import {
  Target, Trash2, Download, Search, Database, GitBranch, Brain,
  ArrowUpDown, BarChart3, Scissors, X, ChevronDown, Loader2,
  RefreshCw, Eye, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Award, Box,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { NoWorkspaceState, EmptyState, LoadingState, ErrorState } from "@/components/ui/state-display";
import {
  getLinkedWorkspaces,
  getN4AWorkspacePredictionsData,
  getN4AWorkspacePredictionsSummary,
  getAggregatedPredictions,
  exportAggregatedPredictions,
} from "@/api/client";
import type {
  PredictionRecord, LinkedWorkspace, PredictionSummaryResponse,
} from "@/types/linked-workspaces";
import type { ChainSummary } from "@/types/aggregated-predictions";
import { PredictionQuickView } from "@/components/predictions/PredictionQuickView";
import { MetricSelector, useMetricSelection } from "@/components/scores/MetricSelector";
import { AggregationToggle, type AggregationMode } from "@/components/scores/AggregationToggle";
import { CVDetailTable } from "@/components/scores/CVDetailTable";
import { ModelActionMenu } from "@/components/scores/ModelActionMenu";
import {
  formatMetricValue, formatScore, isLowerBetter, isBetterScore,
  getMetricAbbreviation, extractScoreValue,
} from "@/lib/scores";

type SortField = "model_name" | "dataset_name" | "partition" | "val_score" | "test_score" | "n_samples";
type SortOrder = "asc" | "desc";
type AggSortField = "model_name" | "dataset_name" | "final" | "cv_val" | "cv_test" | "folds";

export default function Predictions() {
  const { t } = useTranslation();

  // Aggregation toggle
  const [aggMode, setAggMode] = useState<AggregationMode>("aggregated");

  // Metric selection (persisted)
  const [selectedMetrics, setSelectedMetrics] = useMetricSelection("predictions", "regression");

  // Two-phase loading for per-fold mode
  const [summary, setSummary] = useState<PredictionSummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [predictions, setPredictions] = useState<PredictionRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<LinkedWorkspace | null>(null);
  const [filterDataset, setFilterDataset] = useState<string>("all");
  const [filterModel, setFilterModel] = useState<string>("all");
  const [filterPartition, setFilterPartition] = useState<string>("all");
  const [filterTaskType, setFilterTaskType] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("val_score");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [quickViewPrediction, setQuickViewPrediction] = useState<PredictionRecord | null>(null);
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportSelection, setExportSelection] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

  // Aggregated view state
  const [aggSortField, setAggSortField] = useState<AggSortField>("final");
  const [aggSortOrder, setAggSortOrder] = useState<SortOrder>("desc");
  const [expandedChainId, setExpandedChainId] = useState<string | null>(null);

  // Aggregated data (React Query)
  const {
    data: aggData,
    isLoading: aggLoading,
    refetch: refetchAgg,
  } = useQuery({
    queryKey: ["aggregated-predictions", filterDataset, filterModel],
    queryFn: () => getAggregatedPredictions({
      dataset_name: filterDataset !== "all" ? filterDataset : undefined,
      model_class: filterModel !== "all" ? filterModel : undefined,
    }),
    enabled: aggMode === "aggregated" && !!activeWorkspace,
    staleTime: 30000,
  });

  // Phase 1: Load summary on mount
  useEffect(() => { loadSummary(); }, []);

  const loadSummary = async () => {
    setSummaryLoading(true);
    setError(null);
    try {
      const workspacesRes = await getLinkedWorkspaces();
      const active = workspacesRes.workspaces.find((w) => w.is_active);
      if (!active) {
        setActiveWorkspace(null);
        setSummary(null);
        setTotalCount(0);
        return;
      }
      setActiveWorkspace(active);
      const summaryRes = await getN4AWorkspacePredictionsSummary(active.id);
      setSummary(summaryRes);
      setTotalCount(summaryRes.total_predictions);
      if (aggMode === "per-fold") await loadDetails(active.id, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("predictions.errorLoad"));
    } finally {
      setSummaryLoading(false);
    }
  };

  const loadDetails = async (workspaceId: string, offset: number) => {
    setIsLoading(true);
    try {
      const res = await getN4AWorkspacePredictionsData(workspaceId, {
        limit: pageSize, offset,
        dataset: filterDataset !== "all" ? filterDataset : undefined,
      });
      setPredictions(res.records);
      setTotalCount(res.total);
    } catch (err) {
      console.error("Failed to load details:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeWorkspace && aggMode === "per-fold") {
      const offset = (currentPage - 1) * pageSize;
      loadDetails(activeWorkspace.id, offset);
    }
  }, [currentPage, pageSize, filterDataset, aggMode]);

  // Derived data
  const datasets = useMemo(() => {
    if (summary?.datasets) return summary.datasets.map((d) => d.dataset);
    return [...new Set(predictions.map((p) => p.source_dataset || p.dataset_name))];
  }, [summary, predictions]);

  const models = useMemo(() => {
    if (summary?.models) return summary.models.map((m) => m.name);
    return [...new Set(predictions.map((p) => p.model_name).filter(Boolean))];
  }, [summary, predictions]);

  const partitions = useMemo(() => [...new Set(predictions.map((p) => p.partition).filter(Boolean))], [predictions]);
  const taskTypes = useMemo(() => [...new Set(predictions.map((p) => p.task_type).filter(Boolean))], [predictions]);

  const stats = useMemo(() => {
    if (summary) {
      return {
        total: summary.total_predictions,
        datasets: summary.total_datasets,
        models: summary.models.length,
        pipelines: (summary.datasets ?? []).reduce((acc, d) => acc + (d.facets?.n_pipelines || 0), 0),
      };
    }
    return {
      total: predictions.length,
      datasets: new Set(predictions.map((p) => p.source_dataset || p.dataset_name)).size,
      models: new Set(predictions.map((p) => p.model_name).filter(Boolean)).size,
      pipelines: new Set(predictions.map((p) => p.pipeline_uid).filter(Boolean)).size,
    };
  }, [summary, predictions]);

  // Aggregated view: filter + sort chains
  const filteredChains = useMemo(() => {
    if (!aggData?.predictions) return [];
    let chains = aggData.predictions;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      chains = chains.filter(c =>
        c.model_name?.toLowerCase().includes(q) ||
        c.dataset_name?.toLowerCase().includes(q) ||
        c.preprocessings?.toLowerCase().includes(q)
      );
    }
    if (filterDataset !== "all") chains = chains.filter(c => c.dataset_name === filterDataset);
    if (filterModel !== "all") chains = chains.filter(c => c.model_name === filterModel || c.model_class === filterModel);

    // Sort: refit first, then by score
    chains = [...chains].sort((a, b) => {
      const aRefit = a.final_test_score != null ? 0 : 1;
      const bRefit = b.final_test_score != null ? 0 : 1;
      if (aRefit !== bRefit) return aRefit - bRefit;

      let cmp = 0;
      switch (aggSortField) {
        case "final": cmp = (a.final_test_score ?? 999) - (b.final_test_score ?? 999); break;
        case "cv_val": cmp = (a.cv_val_score ?? 999) - (b.cv_val_score ?? 999); break;
        case "cv_test": cmp = (a.cv_test_score ?? 999) - (b.cv_test_score ?? 999); break;
        case "folds": cmp = a.cv_fold_count - b.cv_fold_count; break;
        case "model_name": cmp = (a.model_name || "").localeCompare(b.model_name || ""); break;
        case "dataset_name": cmp = (a.dataset_name || "").localeCompare(b.dataset_name || ""); break;
      }
      // For error metrics (lower is better), ascending is "best first"
      const metric = a.metric || "rmse";
      const naturalAsc = isLowerBetter(metric);
      if (aggSortField === "final" || aggSortField === "cv_val" || aggSortField === "cv_test") {
        return naturalAsc ? cmp : -cmp;
      }
      return aggSortOrder === "asc" ? cmp : -cmp;
    });
    return chains;
  }, [aggData, searchQuery, filterDataset, filterModel, aggSortField, aggSortOrder]);

  // Per-fold view: filter + sort
  const filteredPredictions = useMemo(() => {
    let result = predictions;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.model_name?.toLowerCase().includes(q) ||
        p.dataset_name?.toLowerCase().includes(q) ||
        p.source_dataset?.toLowerCase().includes(q) ||
        p.preprocessings?.toLowerCase().includes(q)
      );
    }
    if (filterDataset !== "all") result = result.filter(p => (p.source_dataset || p.dataset_name) === filterDataset);
    if (filterModel !== "all") result = result.filter(p => p.model_name === filterModel);
    if (filterPartition !== "all") result = result.filter(p => p.partition === filterPartition);
    if (filterTaskType !== "all") result = result.filter(p => p.task_type === filterTaskType);

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "val_score": cmp = (a.val_score ?? 0) - (b.val_score ?? 0); break;
        case "test_score": cmp = (a.test_score ?? 0) - (b.test_score ?? 0); break;
        case "n_samples": cmp = (a.n_samples ?? 0) - (b.n_samples ?? 0); break;
        case "model_name": cmp = (a.model_name || "").localeCompare(b.model_name || ""); break;
        case "dataset_name": cmp = (a.source_dataset || a.dataset_name || "").localeCompare(b.source_dataset || b.dataset_name || ""); break;
        case "partition": cmp = (a.partition || "").localeCompare(b.partition || ""); break;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return result;
  }, [predictions, searchQuery, filterDataset, filterModel, filterPartition, filterTaskType, sortField, sortOrder]);

  // Helpers
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredPredictions.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredPredictions.map(p => p.id)));
  };
  const toggleSelect = (id: string) => {
    const s = new Set(selectedIds);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelectedIds(s);
  };
  const handleDeleteSelected = () => toast.error("Deleting predictions is not yet supported.");
  const openExportDialog = (names?: string[]) => {
    setExportSelection(new Set(names && names.length > 0 ? names : datasets));
    setExportDialogOpen(true);
  };
  const toggleExportDataset = (d: string) => {
    const s = new Set(exportSelection);
    if (s.has(d)) s.delete(d); else s.add(d);
    setExportSelection(s);
  };
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const handleExportPredictions = async () => {
    const names = Array.from(exportSelection);
    if (names.length === 0) { toast.error("Select at least one dataset"); return; }
    setIsExporting(true);
    try {
      const format = names.length === 1 ? "parquet" : "zip";
      const blob = await exportAggregatedPredictions({ dataset_names: names, format });
      downloadBlob(blob, format === "parquet" ? `${names[0]}.parquet` : `predictions_export_${new Date().toISOString().slice(0, 10)}.zip`);
      toast.success("Export ready");
      setExportDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };
  const handleExportSelected = () => {
    const names = Array.from(new Set(filteredPredictions.filter(p => selectedIds.has(p.id)).map(p => p.source_dataset || p.dataset_name).filter(Boolean) as string[]));
    if (names.length === 0) { toast.info("No datasets resolved"); return; }
    openExportDialog(names);
  };
  const handleQuickView = (pred: PredictionRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    setQuickViewPrediction(pred);
    setQuickViewOpen(true);
  };
  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(p => p === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortOrder("desc"); }
  };
  const handleAggSort = (field: AggSortField) => {
    if (aggSortField === field) setAggSortOrder(p => p === "asc" ? "desc" : "asc");
    else { setAggSortField(field); setAggSortOrder("desc"); }
  };
  const clearFilters = () => {
    setFilterDataset("all"); setFilterModel("all"); setFilterPartition("all");
    setFilterTaskType("all"); setSearchQuery("");
  };
  const hasActiveFilters = filterDataset !== "all" || filterModel !== "all" || filterPartition !== "all" || filterTaskType !== "all";

  const totalPages = Math.ceil(totalCount / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalCount);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, filterDataset, filterModel, filterPartition, filterTaskType, sortField, sortOrder]);

  const SortableHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <TableHead className="cursor-pointer hover:text-foreground transition-colors" onClick={() => handleSort(field)}>
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && <ArrowUpDown className={cn("h-3 w-3", sortOrder === "asc" && "rotate-180")} />}
      </div>
    </TableHead>
  );

  const AggSortableHeader = ({ field, children }: { field: AggSortField; children: React.ReactNode }) => (
    <TableHead className="cursor-pointer hover:text-foreground transition-colors" onClick={() => handleAggSort(field)}>
      <div className="flex items-center gap-1">
        {children}
        {aggSortField === field && <ArrowUpDown className={cn("h-3 w-3", aggSortOrder === "asc" && "rotate-180")} />}
      </div>
    </TableHead>
  );

  // Loading / error / empty states
  if (summaryLoading) return <LoadingState message={t("predictions.loading")} className="min-h-[400px]" />;
  if (error) return <ErrorState title={t("predictions.error")} message={error} onRetry={loadSummary} retryLabel={t("common.refresh")} />;
  if (!activeWorkspace) return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("predictions.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("predictions.subtitle")}</p>
      </div>
      <NoWorkspaceState title="No workspace linked" description="Link a nirs4all workspace in Settings to view prediction records." />
    </motion.div>
  );
  if (predictions.length === 0 && !aggData?.predictions?.length) return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("predictions.title")}</h1>
        <p className="mt-1 text-muted-foreground">Workspace: {activeWorkspace.name}</p>
      </div>
      <EmptyState icon={Target} title="No predictions yet" description="Run nirs4all.run() to generate predictions." action={{ label: t("common.refresh"), onClick: loadSummary }} />
    </motion.div>
  );

  return (
    <MlLoadingOverlay>
    <motion.div className="space-y-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("predictions.title")}</h1>
          <p className="mt-1 text-muted-foreground">
            {stats.total.toLocaleString()} predictions · {activeWorkspace.name}
            {(isLoading || aggLoading) && <Loader2 className="ml-2 h-3 w-3 animate-spin inline" />}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MetricSelector taskType="regression" selectedMetrics={selectedMetrics} onSelectedMetricsChange={setSelectedMetrics} />
          <Button variant="outline" onClick={() => { loadSummary(); refetchAgg(); }} size="sm">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => openExportDialog()} disabled={datasets.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </div>

      {/* Stats + Toggle */}
      <div className="flex items-center gap-4">
        <div className="grid gap-3 grid-cols-4 flex-1">
          <Card className="glass-card"><CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase font-medium">Total</p>
            <p className="text-xl font-bold">{stats.total.toLocaleString()}</p>
          </CardContent></Card>
          <Card className="glass-card"><CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase font-medium">Datasets</p>
            <p className="text-xl font-bold">{stats.datasets}</p>
          </CardContent></Card>
          <Card className="glass-card"><CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase font-medium">Models</p>
            <p className="text-xl font-bold">{stats.models}</p>
          </CardContent></Card>
          <Card className="glass-card"><CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase font-medium">Pipelines</p>
            <p className="text-xl font-bold">{stats.pipelines}</p>
          </CardContent></Card>
        </div>
        <AggregationToggle value={aggMode} onChange={setAggMode} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search models, datasets..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 h-8 bg-muted/50 text-sm" />
        </div>
        <Select value={filterDataset} onValueChange={setFilterDataset}>
          <SelectTrigger className="w-[150px] h-8 bg-muted/50 text-xs"><Database className="h-3.5 w-3.5 mr-1" /><SelectValue placeholder="Dataset" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Datasets</SelectItem>
            {datasets.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterModel} onValueChange={setFilterModel}>
          <SelectTrigger className="w-[140px] h-8 bg-muted/50 text-xs"><Brain className="h-3.5 w-3.5 mr-1" /><SelectValue placeholder="Model" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Models</SelectItem>
            {models.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        {aggMode === "per-fold" && (
          <Select value={filterPartition} onValueChange={setFilterPartition}>
            <SelectTrigger className="w-[130px] h-8 bg-muted/50 text-xs"><Scissors className="h-3.5 w-3.5 mr-1" /><SelectValue placeholder="Partition" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {partitions.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 gap-1 text-muted-foreground text-xs">
            <X className="h-3 w-3" /> Clear
          </Button>
        )}
      </div>

      {/* ============================================================ */}
      {/* AGGREGATED VIEW */}
      {/* ============================================================ */}
      {aggMode === "aggregated" && (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent text-[11px]">
                  <TableHead className="w-8">#</TableHead>
                  <AggSortableHeader field="model_name">Model</AggSortableHeader>
                  <AggSortableHeader field="dataset_name">Dataset</AggSortableHeader>
                  <TableHead>Preproc</TableHead>
                  <AggSortableHeader field="final">Final</AggSortableHeader>
                  <AggSortableHeader field="cv_val">CV Val</AggSortableHeader>
                  <AggSortableHeader field="cv_test">CV Test</AggSortableHeader>
                  <AggSortableHeader field="folds">Folds</AggSortableHeader>
                  {selectedMetrics.slice(0, 4).map(k => (
                    <TableHead key={k} className="text-right text-[10px]">{getMetricAbbreviation(k)}</TableHead>
                  ))}
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(aggLoading ? [] : filteredChains).map((chain, idx) => {
                  const hasFinal = chain.final_test_score != null;
                  const isExpanded = expandedChainId === chain.chain_id;
                  const rank = idx + 1;
                  const metric = chain.metric || "rmse";

                  return (
                    <Collapsible key={chain.chain_id} open={isExpanded} onOpenChange={() => setExpandedChainId(isExpanded ? null : chain.chain_id)}>
                      <CollapsibleTrigger asChild>
                        <TableRow className={cn(
                          "cursor-pointer text-xs",
                          hasFinal && rank <= 3 && "bg-emerald-500/5",
                          isExpanded && "bg-primary/5",
                        )}>
                          <TableCell>
                            <span className={cn(
                              "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                              rank === 1 ? (hasFinal ? "bg-emerald-500/20 text-emerald-500" : "bg-chart-1/20 text-chart-1") : "bg-muted text-muted-foreground",
                            )}>{rank}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {hasFinal && <Award className="h-3 w-3 text-emerald-500 shrink-0" />}
                              <Badge variant="outline" className={cn("text-[10px] font-mono", hasFinal && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400")}>
                                <Box className="h-2.5 w-2.5 mr-0.5" />{chain.model_name}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{chain.dataset_name}</TableCell>
                          <TableCell>
                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px] block">{chain.preprocessings || "—"}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            {hasFinal
                              ? <span className="font-mono font-semibold text-emerald-500">{formatMetricValue(chain.final_test_score, metric)}</span>
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-chart-1">{formatMetricValue(chain.cv_val_score, metric)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{formatMetricValue(chain.cv_test_score, metric)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{chain.cv_fold_count}</TableCell>
                          {selectedMetrics.slice(0, 4).map(k => {
                            const scores = chain.cv_scores as Record<string, Record<string, number>> | null;
                            const val = hasFinal
                              ? extractScoreValue(chain.final_scores as Record<string, unknown> | null, k, "test")
                              : scores?.val?.[k] ?? null;
                            return (
                              <TableCell key={k} className="text-right font-mono text-[11px] text-muted-foreground">
                                {val != null ? formatMetricValue(val, k) : "—"}
                              </TableCell>
                            );
                          })}
                          <TableCell onClick={e => e.stopPropagation()}>
                            <ModelActionMenu
                              chainId={chain.chain_id}
                              modelName={chain.model_name || ""}
                              datasetName={chain.dataset_name || ""}
                              runId={chain.run_id}
                              pipelineId={chain.pipeline_id}
                              hasRefit={hasFinal}
                            />
                          </TableCell>
                        </TableRow>
                      </CollapsibleTrigger>
                      <CollapsibleContent asChild>
                        <tr>
                          <td colSpan={8 + Math.min(selectedMetrics.length, 4) + 1} className="p-0">
                            <div className="border-t bg-muted/10 p-3">
                              <div className="flex items-center gap-3 mb-3 flex-wrap">
                                {[
                                  { label: isLowerBetter(metric) ? "RMSEP" : "Final", value: chain.final_test_score, cls: "text-emerald-500" },
                                  { label: isLowerBetter(metric) ? "RMSECV" : "CV", value: chain.cv_val_score, cls: "text-chart-1" },
                                  { label: "Ens_Test", value: chain.cv_test_score, cls: "text-muted-foreground" },
                                ].filter(i => i.value != null).map(item => (
                                  <div key={item.label} className="text-center">
                                    <div className="text-muted-foreground uppercase text-[9px] font-medium">{item.label}</div>
                                    <div className={cn("font-mono text-sm font-bold", item.cls)}>{formatMetricValue(item.value, metric)}</div>
                                  </div>
                                ))}
                              </div>
                              <CVDetailTable chainId={chain.chain_id} selectedMetrics={selectedMetrics} metric={metric} />
                            </div>
                          </td>
                        </tr>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {aggLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading aggregated predictions...
            </div>
          )}
          {!aggLoading && filteredChains.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">No chains match your filters</div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* PER-FOLD VIEW */}
      {/* ============================================================ */}
      {aggMode === "per-fold" && (
        <>
          {/* Selection Actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 p-2 glass-card text-sm">
              <span className="font-medium">{selectedIds.size} selected</span>
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => toast.info(`Analyzing ${selectedIds.size} predictions`)} className="h-7 gap-1 text-xs">
                <BarChart3 className="h-3 w-3" /> Analyze
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportSelected} className="h-7 gap-1 text-xs">
                <Download className="h-3 w-3" /> Export
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1 text-xs text-destructive hover:text-destructive">
                    <Trash2 className="h-3 w-3" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selectedIds.size} predictions?</AlertDialogTitle>
                    <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteSelected} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent text-[11px]">
                    <TableHead className="w-10">
                      <Checkbox checked={selectedIds.size === filteredPredictions.length && filteredPredictions.length > 0} onCheckedChange={toggleSelectAll} />
                    </TableHead>
                    <SortableHeader field="dataset_name">Dataset</SortableHeader>
                    <SortableHeader field="model_name">Model</SortableHeader>
                    <TableHead>Fold</TableHead>
                    <SortableHeader field="partition">Partition</SortableHeader>
                    <TableHead>Preproc</TableHead>
                    <SortableHeader field="val_score">Val</SortableHeader>
                    <SortableHeader field="test_score">Test</SortableHeader>
                    {selectedMetrics.slice(0, 4).map(k => (
                      <TableHead key={k} className="text-right text-[10px]">{getMetricAbbreviation(k)}</TableHead>
                    ))}
                    <SortableHeader field="n_samples">N</SortableHeader>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPredictions.map(pred => {
                    const isFinal = pred.fold_id === "final";
                    const isAvg = pred.fold_id === "avg" || pred.fold_id === "w_avg";
                    return (
                      <TableRow
                        key={pred.id}
                        className={cn("text-xs cursor-pointer", selectedIds.has(pred.id) && "bg-primary/5", isFinal && "bg-emerald-500/5")}
                        onClick={() => toggleSelect(pred.id)}
                      >
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Checkbox checked={selectedIds.has(pred.id)} onCheckedChange={() => toggleSelect(pred.id)} />
                        </TableCell>
                        <TableCell>
                          <span className="truncate max-w-[100px] block">{pred.source_dataset || pred.dataset_name}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Brain className="h-3 w-3 text-primary shrink-0" />
                            <span>{pred.model_name || "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {isFinal ? <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-500">Final</Badge>
                            : isAvg ? <Badge variant="outline" className="text-[9px] border-chart-1/30 text-chart-1">{pred.fold_id === "avg" ? "Avg" : "W-Avg"}</Badge>
                            : <span className="text-muted-foreground">{pred.fold_id ?? "—"}</span>}
                        </TableCell>
                        <TableCell><Badge variant="secondary" className="text-[9px]">{pred.partition || "—"}</Badge></TableCell>
                        <TableCell><span className="text-[10px] text-muted-foreground truncate max-w-[120px] block">{pred.preprocessings || "—"}</span></TableCell>
                        <TableCell className="text-right font-mono text-chart-1">{formatScore(pred.val_score)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{formatScore(pred.test_score)}</TableCell>
                        {selectedMetrics.slice(0, 4).map(k => {
                          const scores = pred.scores as Record<string, Record<string, number>> | undefined;
                          const val = scores?.val?.[k] ?? scores?.test?.[k];
                          return (
                            <TableCell key={k} className="text-right font-mono text-[11px] text-muted-foreground">
                              {val != null ? formatMetricValue(val, k) : "—"}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right text-muted-foreground">{pred.n_samples ?? "—"}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={e => handleQuickView(pred, e)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Pagination */}
          {totalCount > 0 && (
            <div className="flex items-center justify-between px-1 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>Showing {startIndex + 1}-{endIndex} of {totalCount}</span>
                <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setCurrentPage(1); }}>
                  <SelectTrigger className="w-[85px] h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[25, 50, 100, 200].map(n => <SelectItem key={n} value={String(n)}>{n}/page</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-0.5">
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}><ChevronsLeft className="h-3.5 w-3.5" /></Button>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                <span className="px-2 text-muted-foreground">Page {currentPage} of {totalPages}</span>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}><ChevronRight className="h-3.5 w-3.5" /></Button>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}><ChevronsRight className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          )}

          {filteredPredictions.length === 0 && predictions.length > 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">No predictions match your filters</div>
          )}
        </>
      )}

      {/* Export Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Export Predictions</DialogTitle>
            <DialogDescription>Select datasets to export (.parquet or .zip).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-auto">
            {datasets.map(d => (
              <label key={d} className="flex items-center gap-2 text-sm">
                <Checkbox checked={exportSelection.has(d)} onCheckedChange={() => toggleExportDataset(d)} />
                <span>{d}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setExportSelection(new Set(datasets))} disabled={isExporting}>All</Button>
            <Button variant="outline" size="sm" onClick={() => setExportSelection(new Set())} disabled={isExporting}>None</Button>
            <Button onClick={handleExportPredictions} disabled={isExporting}>
              {isExporting ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Exporting...</> : "Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick View */}
      <PredictionQuickView prediction={quickViewPrediction} open={quickViewOpen} onOpenChange={setQuickViewOpen} workspaceId={activeWorkspace?.id} />
    </motion.div>
    </MlLoadingOverlay>
  );
}
