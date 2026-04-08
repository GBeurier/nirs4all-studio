/**
 * DatasetQuickView - Inline panel for quick dataset preview
 *
 * Shows always-visible spectra and target previews alongside dataset stats.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "@/lib/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  X,
  ExternalLink,
  Settings,
  Database,
  Layers,
  Hash,
  Target,
  BarChart3,
  RefreshCw,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { SpectraChart, TargetHistogram } from "./charts";
import { PartitionToggle } from "./PartitionToggle";
import { getPartitionTheme } from "./partitionTheme";
import { previewDatasetById } from "@/api/client";
import type { Dataset, PartitionKey, PreviewDataResponse } from "@/types/datasets";

interface DatasetQuickViewProps {
  dataset: Dataset | null;
  onClose: () => void;
  onEdit?: (dataset: Dataset) => void;
}

function formatNumber(num: number | undefined | null): string {
  if (num == null) return "--";
  return num.toLocaleString();
}

export function DatasetQuickView({
  dataset,
  onClose,
  onEdit,
}: DatasetQuickViewProps) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<PreviewDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState(0);
  const [partition, setPartition] = useState<PartitionKey>("all");

  const loadPreview = useCallback(async () => {
    if (!dataset?.id) return;

    setLoading(true);
    setError(null);

    try {
      const result = await previewDatasetById(dataset.id, 100);
      setPreview(result);
      if (result.error) {
        setError(result.error);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load preview";
      setError(message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [dataset?.id]);

  useEffect(() => {
    if (dataset) {
      setPreview(null);
      setError(null);
      setSelectedSource(0);
      setPartition("all");
      loadPreview();
    }
  }, [dataset?.id, loadPreview]);

  const numSamples = dataset?.num_samples ?? preview?.summary?.num_samples;
  const numFeatures = dataset?.num_features ?? preview?.summary?.num_features;
  const nSources = dataset?.n_sources ?? preview?.summary?.n_sources ?? 1;
  const trainCount = preview?.summary?.train_samples ?? dataset?.train_samples;
  const testCount = preview?.summary?.test_samples ?? dataset?.test_samples;
  const hasTest = !!preview?.spectra_preview_by_partition?.test
    || !!preview?.target_distribution_by_partition?.test
    || (testCount != null && testCount > 0);
  const effectivePartition: PartitionKey = !hasTest && partition !== "train" ? "train" : partition;
  const partitionTheme = getPartitionTheme(effectivePartition);

  const spectraData = useMemo(() => {
    if (!preview) return undefined;

    if (preview.summary.n_sources > 1 && preview.spectra_per_source_by_partition?.[selectedSource]) {
      return preview.spectra_per_source_by_partition[selectedSource][effectivePartition]
        ?? preview.spectra_per_source_by_partition[selectedSource].train
        ?? preview.spectra_per_source?.[selectedSource];
    }

    return preview.spectra_preview_by_partition?.[effectivePartition]
      ?? preview.spectra_preview_by_partition?.train
      ?? preview.spectra_preview;
  }, [preview, selectedSource, effectivePartition]);

  const distribution = useMemo(() => {
    return preview?.target_distribution_by_partition?.[effectivePartition]
      ?? preview?.target_distribution_by_partition?.train
      ?? preview?.target_distribution;
  }, [preview, effectivePartition]);

  if (!dataset) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={dataset.id}
        initial={{ opacity: 0, width: 0 }}
        animate={{ opacity: 1, width: 480 }}
        exit={{ opacity: 0, width: 0 }}
        transition={{ duration: 0.2 }}
        className="flex-shrink-0 overflow-hidden"
      >
        <div className="max-h-[calc(100vh-6rem)] rounded-xl border border-border bg-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-border p-4 flex-shrink-0">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-foreground truncate">{dataset.name}</h3>
              <p className="text-xs text-muted-foreground font-mono truncate">{dataset.path}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 ml-2">
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 p-4 border-b border-border flex-shrink-0">
            <div className="text-center">
              <Layers className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-semibold">{formatNumber(numSamples)}</p>
              <p className="text-xs text-muted-foreground">Samples</p>
              {testCount != null && testCount > 0 && (
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  {formatNumber(trainCount)} / {formatNumber(testCount)}
                </p>
              )}
            </div>
            <div className="text-center">
              <Hash className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-semibold">{formatNumber(numFeatures)}</p>
              <p className="text-xs text-muted-foreground">Features</p>
            </div>
            <div className="text-center">
              <Target className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-semibold">{dataset.targets?.length || "--"}</p>
              <p className="text-xs text-muted-foreground">Targets</p>
            </div>
            <div className="text-center">
              <Database className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-semibold">{nSources}</p>
              <p className="text-xs text-muted-foreground">Sources</p>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              {loading && (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                  <p className="text-muted-foreground text-sm">Loading preview...</p>
                </div>
              )}

              {error && !loading && (
                <div className="flex flex-col items-center justify-center py-12">
                  <AlertCircle className="h-8 w-8 text-destructive mb-4" />
                  <p className="text-destructive font-medium mb-2 text-sm">Failed to load</p>
                  <p className="text-xs text-muted-foreground mb-4 text-center">{error}</p>
                  <Button onClick={loadPreview} variant="outline" size="sm">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </div>
              )}

              {!loading && !error && (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <BarChart3 className="h-4 w-4" />
                          Spectra Preview
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          {preview?.summary.n_sources > 1 && preview.spectra_per_source && (
                            <select
                              className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                              value={selectedSource}
                              onChange={(event) => setSelectedSource(Number(event.target.value))}
                            >
                              {Object.keys(preview.spectra_per_source).map((sourceIdx) => (
                                <option key={sourceIdx} value={Number(sourceIdx)}>
                                  Source {Number(sourceIdx) + 1}
                                </option>
                              ))}
                            </select>
                          )}
                          <PartitionToggle
                            value={effectivePartition}
                            onChange={setPartition}
                            hasTest={hasTest}
                            trainCount={trainCount}
                            testCount={testCount}
                            size="xs"
                          />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {spectraData ? (
                        <SpectraChart
                          wavelengths={spectraData.wavelengths}
                          meanSpectrum={spectraData.mean_spectrum}
                          minSpectrum={spectraData.min_spectrum}
                          maxSpectrum={spectraData.max_spectrum}
                          width={440}
                          height={260}
                          lineColor={partitionTheme.lineColor}
                          rangeFillColor={partitionTheme.rangeFillColor}
                        />
                      ) : (
                        <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg">
                          No spectra data available
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Target className="h-4 w-4" />
                          Target Distribution
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <PartitionToggle
                            value={effectivePartition}
                            onChange={setPartition}
                            hasTest={hasTest}
                            trainCount={trainCount}
                            testCount={testCount}
                            size="xs"
                          />
                          {distribution && (
                            <Badge variant="outline" className="text-xs capitalize">
                              {distribution.type}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {distribution ? (
                        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(140px,1fr)] gap-4 items-start">
                          <div>
                            {distribution.histogram ? (
                              <TargetHistogram
                                data={distribution.histogram}
                                type={distribution.type}
                                width={440}
                                height={200}
                                barColor={partitionTheme.histogramColor}
                              />
                            ) : (
                              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg">
                                No histogram available
                              </div>
                            )}
                          </div>
                          <div className="space-y-2">
                            {distribution.type === "regression" ? (
                              <>
                                <div className="p-3 bg-muted/30 rounded-lg">
                                  <p className="text-xs text-muted-foreground">Min</p>
                                  <p className="font-mono font-medium">{distribution.min?.toFixed(3) || "--"}</p>
                                </div>
                                <div className="p-3 bg-muted/30 rounded-lg">
                                  <p className="text-xs text-muted-foreground">Max</p>
                                  <p className="font-mono font-medium">{distribution.max?.toFixed(3) || "--"}</p>
                                </div>
                                <div className="p-3 bg-muted/30 rounded-lg">
                                  <p className="text-xs text-muted-foreground">Mean</p>
                                  <p className="font-mono font-medium">{distribution.mean?.toFixed(3) || "--"}</p>
                                </div>
                                <div className="p-3 bg-muted/30 rounded-lg">
                                  <p className="text-xs text-muted-foreground">Std</p>
                                  <p className="font-mono font-medium">{distribution.std?.toFixed(3) || "--"}</p>
                                </div>
                              </>
                            ) : (
                              <div className="space-y-2">
                                {distribution.class_counts && Object.entries(distribution.class_counts).map(([label, count]) => (
                                  <div key={label} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-sm">
                                    <span className="text-muted-foreground">{label}</span>
                                    <span className="font-mono font-medium">{count}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg">
                          No target preview available
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Dataset Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-muted/30 rounded-lg">
                          <p className="text-xs text-muted-foreground">Spectral Range</p>
                          <p className="text-lg font-bold">
                            {spectraData
                              ? `${Math.min(...spectraData.wavelengths).toFixed(0)} - ${Math.max(...spectraData.wavelengths).toFixed(0)}`
                              : "--"}
                          </p>
                        </div>
                        <div className="p-3 bg-muted/30 rounded-lg">
                          <p className="text-xs text-muted-foreground">Task Type</p>
                          <p className="text-lg font-bold capitalize">{dataset.task_type || "auto"}</p>
                        </div>
                      </div>

                      {dataset.targets && dataset.targets.length > 0 && (
                        <div className="p-3 bg-muted/30 rounded-lg">
                          <p className="text-xs text-muted-foreground mb-2">Target Variables</p>
                          <div className="flex flex-wrap gap-2">
                            {dataset.targets.map((target) => (
                              <Badge
                                key={target.column}
                                variant={target.column === dataset.default_target ? "default" : "outline"}
                                className="text-xs"
                              >
                                {target.column}
                                {target.unit && <span className="ml-1 opacity-70">({target.unit})</span>}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </ScrollArea>

          <div className="border-t border-border p-4 flex gap-2 flex-shrink-0">
            {onEdit && (
              <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(dataset)}>
                <Settings className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => navigate(`/datasets/${dataset.id}`)}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Details
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
