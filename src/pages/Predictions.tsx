import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import { Link } from "react-router-dom";
import {
  Target,
  Trash2,
  Download,
  Search,
  Database,
  GitBranch,
  Brain,
  ArrowUpDown,
  BarChart3,
  Scissors,
  Settings2,
  X,
  ChevronDown,
  Loader2,
  AlertCircle,
  FolderOpen,
  RefreshCw,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getLinkedWorkspaces,
  getN4AWorkspacePredictionsData,
  getN4AWorkspacePredictionsSummary,
} from "@/api/client";
import type {
  PredictionRecord,
  LinkedWorkspace,
  PredictionSummaryResponse,
  ModelFacet,
  TopPrediction,
} from "@/types/linked-workspaces";
import { PredictionQuickView } from "@/components/predictions/PredictionQuickView";

type SortField = "model_name" | "dataset_name" | "partition" | "val_score" | "test_score" | "n_samples";
type SortOrder = "asc" | "desc";

export default function Predictions() {
  const { t } = useTranslation();

  const allMetrics = [
    { key: "val_score", label: t("predictions.metrics.valScore"), higherBetter: true },
    { key: "test_score", label: t("predictions.metrics.testScore"), higherBetter: true },
    { key: "train_score", label: t("predictions.metrics.trainScore"), higherBetter: true },
  ];
  // Two-phase loading: summary (instant) + details (on-demand)
  const [summary, setSummary] = useState<PredictionSummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [predictions, setPredictions] = useState<PredictionRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<LinkedWorkspace | null>(null);

  // Multi-filters
  const [filterDataset, setFilterDataset] = useState<string>("all");
  const [filterModel, setFilterModel] = useState<string>("all");
  const [filterPartition, setFilterPartition] = useState<string>("all");
  const [filterTaskType, setFilterTaskType] = useState<string>("all");

  // Score configuration
  const [visibleMetrics, setVisibleMetrics] = useState<Set<string>>(
    new Set(["val_score", "test_score"])
  );

  const [sortField, setSortField] = useState<SortField>("val_score");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Quick view state
  const [quickViewPrediction, setQuickViewPrediction] = useState<PredictionRecord | null>(null);
  const [quickViewOpen, setQuickViewOpen] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Phase 1: Load summary on mount (instant ~10-50ms)
  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    setSummaryLoading(true);
    setError(null);
    try {
      // Get active workspace
      const workspacesRes = await getLinkedWorkspaces();
      const active = workspacesRes.workspaces.find((w) => w.is_active);

      if (!active) {
        setActiveWorkspace(null);
        setSummary(null);
        setTotalCount(0);
        return;
      }

      setActiveWorkspace(active);

      // Load summary (instant - reads only parquet footers)
      const summaryRes = await getN4AWorkspacePredictionsSummary(active.id);
      setSummary(summaryRes);
      setTotalCount(summaryRes.total_predictions);

      // Auto-load first page of details
      await loadDetails(active.id, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("predictions.errorLoad"));
    } finally {
      setSummaryLoading(false);
    }
  };

  // Phase 2: Load details on-demand with server-side pagination
  const loadDetails = async (workspaceId: string, offset: number) => {
    setIsLoading(true);
    try {
      const predictionsRes = await getN4AWorkspacePredictionsData(workspaceId, {
        limit: pageSize,
        offset,
        dataset: filterDataset !== "all" ? filterDataset : undefined,
      });

      setPredictions(predictionsRes.records);
      setTotalCount(predictionsRes.total);
    } catch (err) {
      console.error("Failed to load details:", err);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  // Reload details when page or filter changes
  useEffect(() => {
    if (activeWorkspace) {
      const offset = (currentPage - 1) * pageSize;
      loadDetails(activeWorkspace.id, offset);
    }
  }, [currentPage, pageSize, filterDataset]);

  // Get unique values for filters from summary (instant) or fall back to predictions
  const datasets = useMemo(() => {
    if (summary?.datasets) {
      return summary.datasets.map((d) => d.dataset);
    }
    return [...new Set(predictions.map((p) => p.source_dataset || p.dataset_name))];
  }, [summary, predictions]);

  const models = useMemo(() => {
    if (summary?.models) {
      return summary.models.map((m) => m.name);
    }
    return [...new Set(predictions.map((p) => p.model_name).filter(Boolean))];
  }, [summary, predictions]);

  const partitions = useMemo(
    () => [...new Set(predictions.map((p) => p.partition).filter(Boolean))],
    [predictions]
  );
  const taskTypes = useMemo(
    () => [...new Set(predictions.map((p) => p.task_type).filter(Boolean))],
    [predictions]
  );

  // Stats from summary (instant) - no need to compute from all predictions
  const stats = useMemo(() => {
    if (summary) {
      return {
        total: summary.total_predictions,
        datasets: summary.total_datasets,
        models: summary.models.length,
        pipelines: summary.datasets.reduce((acc, d) => acc + (d.facets?.n_pipelines || 0), 0),
      };
    }
    return {
      total: predictions.length,
      datasets: new Set(predictions.map((p) => p.source_dataset || p.dataset_name)).size,
      models: new Set(predictions.map((p) => p.model_name).filter(Boolean)).size,
      pipelines: new Set(predictions.map((p) => p.pipeline_uid).filter(Boolean)).size,
    };
  }, [summary, predictions]);

  const filteredPredictions = useMemo(() => {
    let result = predictions;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.model_name?.toLowerCase().includes(query) ||
          p.dataset_name?.toLowerCase().includes(query) ||
          p.source_dataset?.toLowerCase().includes(query) ||
          p.preprocessings?.toLowerCase().includes(query)
      );
    }

    if (filterDataset !== "all")
      result = result.filter(
        (p) => (p.source_dataset || p.dataset_name) === filterDataset
      );
    if (filterModel !== "all")
      result = result.filter((p) => p.model_name === filterModel);
    if (filterPartition !== "all")
      result = result.filter((p) => p.partition === filterPartition);
    if (filterTaskType !== "all")
      result = result.filter((p) => p.task_type === filterTaskType);

    result = [...result].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "val_score":
          comparison = (a.val_score ?? 0) - (b.val_score ?? 0);
          break;
        case "test_score":
          comparison = (a.test_score ?? 0) - (b.test_score ?? 0);
          break;
        case "n_samples":
          comparison = (a.n_samples ?? 0) - (b.n_samples ?? 0);
          break;
        case "model_name":
          comparison = (a.model_name || "").localeCompare(b.model_name || "");
          break;
        case "dataset_name":
          comparison = (a.source_dataset || a.dataset_name || "").localeCompare(
            b.source_dataset || b.dataset_name || ""
          );
          break;
        case "partition":
          comparison = (a.partition || "").localeCompare(b.partition || "");
          break;
        default:
          comparison = 0;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [
    predictions,
    searchQuery,
    filterDataset,
    filterModel,
    filterPartition,
    filterTaskType,
    sortField,
    sortOrder,
  ]);

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredPredictions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPredictions.map((p) => p.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleDeleteSelected = () => {
    // TODO: Implement delete
    toast.error("Deleting predictions is not yet supported.");
  };

  const handleExportSelected = () => {
    toast.info(`Exporting ${selectedIds.size} predictions`);
  };

  const handleAnalyzeSelected = () => {
    toast.info(`Analyzing ${selectedIds.size} predictions`);
  };

  const handleQuickView = (prediction: PredictionRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    setQuickViewPrediction(prediction);
    setQuickViewOpen(true);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const toggleMetric = (metric: string) => {
    const newSet = new Set(visibleMetrics);
    if (newSet.has(metric)) {
      newSet.delete(metric);
    } else {
      newSet.add(metric);
    }
    setVisibleMetrics(newSet);
  };

  const clearFilters = () => {
    setFilterDataset("all");
    setFilterModel("all");
    setFilterPartition("all");
    setFilterTaskType("all");
    setSearchQuery("");
  };

  const hasActiveFilters =
    filterDataset !== "all" ||
    filterModel !== "all" ||
    filterPartition !== "all" ||
    filterTaskType !== "all";

  // Pagination calculations
  const totalPages = Math.ceil(filteredPredictions.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedPredictions = filteredPredictions.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterDataset, filterModel, filterPartition, filterTaskType, sortField, sortOrder]);

  const SortableHeader = ({
    field,
    children,
  }: {
    field: SortField;
    children: React.ReactNode;
  }) => (
    <TableHead
      className="cursor-pointer hover:text-foreground transition-colors"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <ArrowUpDown
            className={cn("h-3 w-3", sortOrder === "asc" && "rotate-180")}
          />
        )}
      </div>
    </TableHead>
  );

  // Loading state (initial summary load)
  if (summaryLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">{t("predictions.loading")}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <div>
            <h3 className="text-lg font-semibold">{t("predictions.error")}</h3>
            <p className="text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" onClick={loadSummary}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>
    );
  }

  // No workspace linked state
  if (!activeWorkspace) {
    return (
      <motion.div
        className="space-y-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("predictions.title")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("predictions.subtitle")}
          </p>
        </div>

        <Card>
          <CardContent className="p-12">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mb-4">
                <FolderOpen className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                No workspace linked
              </h3>
              <p className="text-muted-foreground max-w-md mb-6">
                Link a nirs4all workspace in Settings to view prediction records
                from your experiments.
              </p>
              <Link to="/settings">
                <Button>
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Go to Settings
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // Empty state
  if (predictions.length === 0) {
    return (
      <motion.div
        className="space-y-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("predictions.title")}</h1>
          <p className="mt-1 text-muted-foreground">
            Workspace: {activeWorkspace.name}
          </p>
        </div>

        <Card>
          <CardContent className="p-12">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mb-4">
                <Target className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                No predictions yet
              </h3>
              <p className="text-muted-foreground max-w-md mb-6">
                Predictions will appear here after running experiments with
                nirs4all. Run <code className="text-primary">nirs4all.run()</code>{" "}
                to generate predictions.
              </p>
              <Button variant="outline" onClick={loadSummary}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("predictions.title")}</h1>
          <p className="mt-1 text-muted-foreground">
            {stats.total.toLocaleString()} total • {filteredPredictions.length} showing •{" "}
            {activeWorkspace.name}
            {isLoading && (
              <span className="ml-2 inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading...
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadSummary} size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Link to="/results">
            <Button variant="outline" className="gap-2">
              <BarChart3 className="h-4 w-4" /> Visualizations
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Predictions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Datasets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.datasets}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Models
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.models}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pipelines
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pipelines}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("predictions.filters.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-muted/50"
          />
        </div>

        <Select value={filterDataset} onValueChange={setFilterDataset}>
          <SelectTrigger className="w-[160px] bg-muted/50">
            <Database className="h-4 w-4 mr-2" />
            <SelectValue placeholder={t("predictions.filters.dataset")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("predictions.filters.allDatasets")}</SelectItem>
            {datasets.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterModel} onValueChange={setFilterModel}>
          <SelectTrigger className="w-[140px] bg-muted/50">
            <Brain className="h-4 w-4 mr-2" />
            <SelectValue placeholder={t("predictions.filters.model")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("predictions.filters.allModels")}</SelectItem>
            {models.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterPartition} onValueChange={setFilterPartition}>
          <SelectTrigger className="w-[140px] bg-muted/50">
            <Scissors className="h-4 w-4 mr-2" />
            <SelectValue placeholder={t("predictions.filters.partition")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("predictions.filters.allPartitions")}</SelectItem>
            {partitions.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterTaskType} onValueChange={setFilterTaskType}>
          <SelectTrigger className="w-[150px] bg-muted/50">
            <GitBranch className="h-4 w-4 mr-2" />
            <SelectValue placeholder={t("predictions.filters.taskType")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("predictions.filters.allTypes")}</SelectItem>
            {taskTypes.map((type) => (
              <SelectItem key={type} value={type!}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Score Configuration */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Settings2 className="h-4 w-4" />
              Scores
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t("predictions.visibleMetrics")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {allMetrics.map((metric) => (
              <DropdownMenuCheckboxItem
                key={metric.key}
                checked={visibleMetrics.has(metric.key)}
                onCheckedChange={() => toggleMetric(metric.key)}
              >
                {metric.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="gap-1 text-muted-foreground"
          >
            <X className="h-4 w-4" /> Clear
          </Button>
        )}
      </div>

      {/* Selection Actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 glass-card">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={handleAnalyzeSelected}
            className="gap-2"
          >
            <BarChart3 className="h-4 w-4" /> Analyze
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportSelected}
            className="gap-2"
          >
            <Download className="h-4 w-4" /> Export
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete {selectedIds.size} predictions?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. The selected predictions will be
                  permanently removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteSelected}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12">
                  <Checkbox
                    checked={
                      selectedIds.size === filteredPredictions.length &&
                      filteredPredictions.length > 0
                    }
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <SortableHeader field="dataset_name">{t("predictions.table.dataset")}</SortableHeader>
                <SortableHeader field="model_name">{t("predictions.table.model")}</SortableHeader>
                <SortableHeader field="partition">{t("predictions.table.partition")}</SortableHeader>
                <TableHead>{t("predictions.table.preprocessing")}</TableHead>
                <TableHead>{t("predictions.table.fold")}</TableHead>
                {allMetrics
                  .filter((m) => visibleMetrics.has(m.key))
                  .map((metric) => (
                    <SortableHeader
                      key={metric.key}
                      field={metric.key as SortField}
                    >
                      {metric.label}
                    </SortableHeader>
                  ))}
                <SortableHeader field="n_samples">{t("predictions.table.samples")}</SortableHeader>
                <TableHead>{t("predictions.table.task")}</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedPredictions.map((pred) => (
                <TableRow
                  key={pred.id}
                  className={cn(
                    "cursor-pointer",
                    selectedIds.has(pred.id) && "bg-primary/5"
                  )}
                  onClick={() => toggleSelect(pred.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(pred.id)}
                      onCheckedChange={() => toggleSelect(pred.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate max-w-[120px]">
                        {pred.source_dataset || pred.dataset_name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-primary shrink-0" />
                      <span>{pred.model_name || "—"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {pred.partition || "—"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="truncate max-w-[150px] block text-muted-foreground text-xs">
                      {pred.preprocessings || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {pred.fold_id ?? "—"}
                  </TableCell>
                  {allMetrics
                    .filter((m) => visibleMetrics.has(m.key))
                    .map((metric) => {
                      const value = pred[metric.key as keyof PredictionRecord] as
                        | number
                        | null
                        | undefined;
                      if (value === undefined || value === null) {
                        return (
                          <TableCell key={metric.key} className="text-muted-foreground">
                            —
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell key={metric.key}>
                          <span
                            className={cn(
                              "font-mono",
                              value > 0.9
                                ? "text-green-600 dark:text-green-400"
                                : value > 0.7
                                ? "text-foreground"
                                : "text-orange-600 dark:text-orange-400"
                            )}
                          >
                            {value.toFixed(4)}
                          </span>
                        </TableCell>
                      );
                    })}
                  <TableCell>{pred.n_samples ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {pred.task_type || "—"}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => handleQuickView(pred, e)}
                      title={t("predictions.quickView")}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination Controls */}
      {filteredPredictions.length > 0 && (
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              Showing {startIndex + 1}-{Math.min(endIndex, filteredPredictions.length)} of{" "}
              {filteredPredictions.length}
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="w-[100px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
                <SelectItem value="100">100 / page</SelectItem>
                <SelectItem value="200">200 / page</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div className="flex items-center gap-1 px-2">
              <span className="text-sm">
                Page{" "}
                <Input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={currentPage}
                  onChange={(e) => {
                    const page = parseInt(e.target.value);
                    if (page >= 1 && page <= totalPages) {
                      setCurrentPage(page);
                    }
                  }}
                  className="w-16 h-8 text-center inline-block"
                />{" "}
                of {totalPages}
              </span>
            </div>

            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {filteredPredictions.length === 0 && predictions.length > 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No predictions found matching your criteria
        </div>
      )}

      {/* Quick View Dialog */}
      <PredictionQuickView
        prediction={quickViewPrediction}
        open={quickViewOpen}
        onOpenChange={setQuickViewOpen}
      />
    </motion.div>
  );
}
