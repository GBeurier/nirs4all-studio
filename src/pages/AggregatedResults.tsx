/**
 * AggregatedResults page — displays chain-level aggregated predictions
 * from the DuckDB store via the /api/aggregated-predictions endpoint.
 *
 * Hierarchy: Run → Pipeline → Chain → Partition predictions.
 * The page shows one row per (chain, metric, dataset) combination with
 * min/avg/max scores across folds. Clicking a row opens ChainDetailSheet.
 */

import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  Box,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getAggregatedPredictions } from "@/api/client";
import type { AggregatedPrediction } from "@/types/aggregated-predictions";
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

type SortKey = "model" | "avg_val" | "avg_test" | "dataset" | "metric" | "folds";

export default function AggregatedResults() {
  const { t } = useTranslation();

  // State
  const [predictions, setPredictions] = useState<AggregatedPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [datasetFilter, setDatasetFilter] = useState("all");
  const [modelClassFilter, setModelClassFilter] = useState("all");
  const [metricFilter, setMetricFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("avg_val");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedPrediction, setSelectedPrediction] = useState<AggregatedPrediction | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

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

  // Facets for filter dropdowns
  const facets = useMemo(() => {
    const datasets = new Set<string>();
    const modelClasses = new Set<string>();
    const metrics = new Set<string>();
    for (const p of predictions) {
      datasets.add(p.dataset_name);
      modelClasses.add(p.model_class);
      metrics.add(p.metric);
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
          p.model_name.toLowerCase().includes(q) ||
          p.model_class.toLowerCase().includes(q) ||
          p.dataset_name.toLowerCase().includes(q) ||
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
          cmp = a.model_name.localeCompare(b.model_name);
          break;
        case "avg_val":
          cmp = (a.avg_val_score ?? Infinity) - (b.avg_val_score ?? Infinity);
          break;
        case "avg_test":
          cmp = (a.avg_test_score ?? Infinity) - (b.avg_test_score ?? Infinity);
          break;
        case "dataset":
          cmp = a.dataset_name.localeCompare(b.dataset_name);
          break;
        case "metric":
          cmp = a.metric.localeCompare(b.metric);
          break;
        case "folds":
          cmp = a.fold_count - b.fold_count;
          break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return sorted;
  }, [predictions, search, datasetFilter, modelClassFilter, metricFilter, sortKey, sortAsc]);

  // Stats
  const stats = useMemo(() => ({
    total: predictions.length,
    datasets: new Set(predictions.map((p) => p.dataset_name)).size,
    models: new Set(predictions.map((p) => p.model_class)).size,
    metrics: new Set(predictions.map((p) => p.metric)).size,
  }), [predictions]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      // Default direction based on whether scores are "lower is better"
      setSortAsc(key === "avg_val" || key === "avg_test");
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
          icon={<BarChart3 className="h-12 w-12" />}
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
                      onClick={() => handleSort("avg_val")}
                    >
                      Avg Val <SortIcon columnKey="avg_val" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-foreground text-right"
                      onClick={() => handleSort("avg_test")}
                    >
                      Avg Test <SortIcon columnKey="avg_test" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:text-foreground text-center"
                      onClick={() => handleSort("folds")}
                    >
                      Folds <SortIcon columnKey="folds" />
                    </TableHead>
                    <TableHead>Partitions</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((pred) => {
                    const lowerIsBetter = isLowerBetter(pred.metric);
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
                            <div className="font-medium text-sm">{pred.model_name}</div>
                            <div className="text-xs text-muted-foreground">{pred.preprocessings || "—"}</div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{pred.dataset_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{pred.metric}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          <span className={cn(
                            pred.avg_val_score != null && "font-medium",
                            pred.avg_val_score != null && !lowerIsBetter && pred.avg_val_score > 0.9 && "text-green-600 dark:text-green-400",
                            pred.avg_val_score != null && lowerIsBetter && pred.avg_val_score < 0.1 && "text-green-600 dark:text-green-400",
                          )}>
                            {formatScore(pred.avg_val_score)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {formatScore(pred.avg_test_score)}
                        </TableCell>
                        <TableCell className="text-center text-sm">{pred.fold_count}</TableCell>
                        <TableCell>
                          <div className="flex gap-0.5">
                            {pred.partitions.map((p) => (
                              <Badge
                                key={p}
                                variant="outline"
                                className={cn(
                                  "text-[10px] px-1 py-0",
                                  p === "val" && "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300",
                                  p === "test" && "border-green-300 text-green-700 dark:border-green-700 dark:text-green-300",
                                  p === "train" && "border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-300",
                                )}
                              >
                                {p}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Eye className="h-4 w-4 text-muted-foreground" />
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
            icon={<Search className="h-10 w-10" />}
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
  );
}
