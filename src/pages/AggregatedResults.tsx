/**
 * AggregatedResults page — displays chain-level aggregated predictions
 * from the DuckDB store via the /api/aggregated-predictions endpoint.
 *
 * Hierarchy: Run → Pipeline → Chain → Partition predictions.
 * The page shows one row per (chain, metric, dataset) combination with
 * min/avg/max scores across folds. Clicking a row opens ChainDetailSheet.
 */

import { useState, useEffect, useMemo } from "react";
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  BarChart3,
  Database,
  Layers,
  Search,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Eye,
  Download,
  Box,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getAggregatedPredictions,
  downloadAggregatedDatasetParquet,
  runAggregatedPredictionsQuery,
} from "@/api/client";
import { useIsDeveloperMode } from "@/context/DeveloperModeContext";
import type { ChainSummary } from "@/types/aggregated-predictions";
import {
  NoWorkspaceState,
  ErrorState,
  LoadingState,
  EmptyState,
} from "@/components/ui/state-display";
import { ChainDetailSheet } from "@/components/predictions/ChainDetailSheet";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

/** Heuristic: is a lower score better? */
function isLowerBetter(metric: string): boolean {
  const lower = metric.toLowerCase();
  return (
    lower.includes("rmse") ||
    lower.includes("mse") ||
    lower.includes("mae") ||
    lower.includes("error") ||
    lower.includes("loss") ||
    lower.includes("rmsecv") ||
    lower.includes("rmsep")
  );
}

/** Format a nullable score to 4 decimals. */
function formatScore(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toFixed(4);
}

type SortKey = "model" | "cv_val" | "cv_test" | "final_test" | "dataset" | "metric" | "folds";

export default function AggregatedResults() {
  const { t } = useTranslation();
  const isDeveloperMode = useIsDeveloperMode();

  // State
  const [predictions, setPredictions] = useState<ChainSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [datasetFilter, setDatasetFilter] = useState("all");
  const [modelClassFilter, setModelClassFilter] = useState("all");
  const [metricFilter, setMetricFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("cv_val");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedPrediction, setSelectedPrediction] = useState<ChainSummary | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sql, setSql] = useState("SELECT dataset_name, COUNT(*) AS predictions FROM predictions GROUP BY 1 ORDER BY 2 DESC");
  const [sqlLoading, setSqlLoading] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlResult, setSqlResult] = useState<{ columns: string[]; rows: unknown[][]; row_count: number } | null>(null);

  // Load data
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await getAggregatedPredictions();
      setPredictions(resp.predictions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load aggregated predictions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDownloadDataset = async (datasetName: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const blob = await downloadAggregatedDatasetParquet(datasetName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${datasetName}.parquet`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${datasetName}.parquet`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to download parquet";
      toast.error(message);
    }
  };

  const handleRunSql = async () => {
    setSqlLoading(true);
    setSqlError(null);
    try {
      const result = await runAggregatedPredictionsQuery(sql);
      setSqlResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to run query";
      setSqlError(message);
      toast.error(message);
    } finally {
      setSqlLoading(false);
    }
  };

  // Facets for filter dropdowns
  const facets = useMemo(() => {
    const datasets = new Set<string>();
    const modelClasses = new Set<string>();
    const metrics = new Set<string>();
    for (const p of predictions) {
      if (p.dataset_name) datasets.add(p.dataset_name);
      modelClasses.add(p.model_class);
      if (p.metric) metrics.add(p.metric);
    }
    return {
      datasets: Array.from(datasets).sort(),
      modelClasses: Array.from(modelClasses).sort(),
      metrics: Array.from(metrics).sort(),
    };
  }, [predictions]);

  // Filter and sort
  const filtered = useMemo(() => {
    let items = predictions;

    // Text search
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (p) =>
          (p.model_name ?? "").toLowerCase().includes(q) ||
          p.model_class.toLowerCase().includes(q) ||
          (p.dataset_name ?? "").toLowerCase().includes(q) ||
          (p.preprocessings && p.preprocessings.toLowerCase().includes(q))
      );
    }

    // Dropdown filters
    if (datasetFilter !== "all") items = items.filter((p) => p.dataset_name === datasetFilter);
    if (modelClassFilter !== "all") items = items.filter((p) => p.model_class === modelClassFilter);
    if (metricFilter !== "all") items = items.filter((p) => p.metric === metricFilter);

    // Sort
    const sorted = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "model":
          cmp = (a.model_name ?? "").localeCompare(b.model_name ?? "");
          break;
        case "cv_val":
          cmp = (a.cv_val_score ?? Infinity) - (b.cv_val_score ?? Infinity);
          break;
        case "cv_test":
          cmp = (a.cv_test_score ?? Infinity) - (b.cv_test_score ?? Infinity);
          break;
        case "final_test":
          cmp = (a.final_test_score ?? Infinity) - (b.final_test_score ?? Infinity);
          break;
        case "dataset":
          cmp = (a.dataset_name ?? "").localeCompare(b.dataset_name ?? "");
          break;
        case "metric":
          cmp = (a.metric ?? "").localeCompare(b.metric ?? "");
          break;
        case "folds":
          cmp = a.cv_fold_count - b.cv_fold_count;
          break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return sorted;
  }, [predictions, search, datasetFilter, modelClassFilter, metricFilter, sortKey, sortAsc]);

  // Stats
  const stats = useMemo(() => ({
    total: predictions.length,
    datasets: new Set(predictions.map((p) => p.dataset_name).filter(Boolean)).size,
    models: new Set(predictions.map((p) => p.model_class)).size,
    metrics: new Set(predictions.map((p) => p.metric).filter(Boolean)).size,
  }), [predictions]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      // Default direction based on whether scores are "lower is better"
      setSortAsc(key === "cv_val" || key === "cv_test" || key === "final_test");
    }
  };

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) return null;
    return sortAsc ? (
      <ArrowUp className="h-3 w-3 inline ml-0.5" />
    ) : (
      <ArrowDown className="h-3 w-3 inline ml-0.5" />
    );
  };

  // Error state
  if (error && predictions.length === 0) {
    // If it's a 409 (no workspace), show workspace state
    if (error.includes("No workspace") || error.includes("409")) {
      return <NoWorkspaceState />;
    }
    return <ErrorState message={error} onRetry={loadData} />;
  }

  return (
    <MlLoadingOverlay>
    <motion.div
      className="flex flex-col gap-6 p-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("aggregatedResults.title", "Aggregated Results")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("aggregatedResults.subtitle", "Chain-level model performance across folds and partitions")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
          {t("common.refresh", "Refresh")}
        </Button>
      </motion.div>

      {/* Stats bar */}
      {!loading && predictions.length > 0 && (
        <motion.div variants={itemVariants} className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Chains</span>
              </div>
              <p className="text-2xl font-bold mt-1">{stats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Datasets</span>
              </div>
              <p className="text-2xl font-bold mt-1">{stats.datasets}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <Box className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Models</span>
              </div>
              <p className="text-2xl font-bold mt-1">{stats.models}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Metrics</span>
              </div>
              <p className="text-2xl font-bold mt-1">{stats.metrics}</p>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Filters */}
      {!loading && predictions.length > 0 && (
        <motion.div variants={itemVariants} className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("common.search", "Search") + "..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <Select value={datasetFilter} onValueChange={setDatasetFilter}>
            <SelectTrigger className="w-[160px] h-9 text-sm">
              <SelectValue placeholder="Dataset" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Datasets</SelectItem>
              {facets.datasets.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={modelClassFilter} onValueChange={setModelClassFilter}>
            <SelectTrigger className="w-[160px] h-9 text-sm">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Models</SelectItem>
              {facets.modelClasses.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={metricFilter} onValueChange={setMetricFilter}>
            <SelectTrigger className="w-[140px] h-9 text-sm">
              <SelectValue placeholder="Metric" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Metrics</SelectItem>
              {facets.metrics.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(search || datasetFilter !== "all" || modelClassFilter !== "all" || metricFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setDatasetFilter("all");
                setModelClassFilter("all");
                setMetricFilter("all");
              }}
            >
              {t("common.clear", "Clear")}
            </Button>
          )}
        </motion.div>
      )}

      {/* Loading */}
      {loading && <LoadingState message={t("aggregatedResults.loading", "Loading aggregated results...")} />}

      {/* Empty */}
      {!loading && predictions.length === 0 && !error && (
        <EmptyState
          icon={BarChart3}
          title={t("aggregatedResults.empty", "No aggregated results yet")}
          description={t(
            "aggregatedResults.emptyHint",
            "Run a pipeline to generate prediction results that will be aggregated here."
          )}
        />
      )}

      {/* Results table */}
      {!loading && filtered.length > 0 && (
        <motion.div variants={itemVariants}>
          {isDeveloperMode && (
            <Card className="mb-4">
              <CardHeader className="pb-3">
                <div className="text-sm font-medium">Developer SQL Query</div>
                <p className="text-xs text-muted-foreground">
                  Read-only SQL against prediction metadata (DuckDB tables/views).
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  className="font-mono text-xs min-h-[100px]"
                />
                <div className="flex items-center gap-2">
                  <Button onClick={handleRunSql} disabled={sqlLoading}>
                    {sqlLoading ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Running...
                      </>
                    ) : (
                      "Run Query"
                    )}
                  </Button>
                  {sqlResult && (
                    <span className="text-xs text-muted-foreground">
                      {sqlResult.row_count} rows
                    </span>
                  )}
                </div>
                {sqlError && <p className="text-sm text-destructive">{sqlError}</p>}
                {sqlResult && sqlResult.columns.length > 0 && (
                  <div className="max-h-56 overflow-auto rounded border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {sqlResult.columns.map((col) => (
                            <TableHead key={col}>{col}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sqlResult.rows.slice(0, 50).map((row, idx) => (
                          <TableRow key={idx}>
                            {row.map((value, colIdx) => (
                              <TableCell key={`${idx}-${colIdx}`} className="text-xs">
                                {String(value)}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {filtered.length} of {predictions.length} chains
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer hover:text-foreground"
                      onClick={() => handleSort("model")}
                    >
                      Model <SortIcon columnKey="model" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-foreground"
                      onClick={() => handleSort("dataset")}
                    >
                      Dataset <SortIcon columnKey="dataset" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-foreground"
                      onClick={() => handleSort("metric")}
                    >
                      Metric <SortIcon columnKey="metric" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-foreground text-right"
                      onClick={() => handleSort("cv_val")}
                    >
                      CV Val <SortIcon columnKey="cv_val" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-foreground text-right"
                      onClick={() => handleSort("cv_test")}
                    >
                      CV Test <SortIcon columnKey="cv_test" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-foreground text-right"
                      onClick={() => handleSort("final_test")}
                    >
                      Final <SortIcon columnKey="final_test" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-foreground text-center"
                      onClick={() => handleSort("folds")}
                    >
                      Folds <SortIcon columnKey="folds" />
                    </TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((pred) => {
                    const lowerIsBetter = isLowerBetter(pred.metric ?? "");
                    const hasFinal = pred.final_test_score != null;
                    return (
                      <TableRow
                        key={`${pred.chain_id}-${pred.metric}-${pred.dataset_name}`}
                        className="cursor-pointer hover:bg-accent/50"
                        onClick={() => {
                          setSelectedPrediction(pred);
                          setSheetOpen(true);
                        }}
                      >
                        <TableCell>
                          <div>
                            <div className="font-medium text-sm">{pred.model_name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{pred.preprocessings || "—"}</div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{pred.dataset_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{pred.metric}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          <span className={cn(
                            pred.cv_val_score != null && "font-medium",
                            pred.cv_val_score != null && !lowerIsBetter && pred.cv_val_score > 0.9 && "text-green-600 dark:text-green-400",
                            pred.cv_val_score != null && lowerIsBetter && pred.cv_val_score < 0.1 && "text-green-600 dark:text-green-400",
                          )}>
                            {formatScore(pred.cv_val_score)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {formatScore(pred.cv_test_score)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {hasFinal ? (
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">
                              {formatScore(pred.final_test_score)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-sm">{pred.cv_fold_count}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => pred.dataset_name && handleDownloadDataset(pred.dataset_name, e)}
                              disabled={!pred.dataset_name}
                              title="Download parquet"
                            >
                              <Download className="h-4 w-4 text-muted-foreground" />
                            </Button>
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* No matches after filtering */}
      {!loading && predictions.length > 0 && filtered.length === 0 && (
        <motion.div variants={itemVariants}>
          <EmptyState
            icon={Search}
            title="No matching results"
            description="Try adjusting your filters or search terms."
          />
        </motion.div>
      )}

      {/* Detail sheet */}
      <ChainDetailSheet
        prediction={selectedPrediction}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </motion.div>
    </MlLoadingOverlay>
  );
}
