/**
 * DatasetQuickView - Inline panel for quick dataset preview
 *
 * Shows always-visible spectra and target previews alongside dataset stats.
 */
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "@/lib/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { buildTargetHistogramData } from "./charts/TargetHistogram";
import { PartitionToggle } from "./PartitionToggle";
import { getPartitionTheme } from "./partitionTheme";
import { useDatasetPreviewQuery } from "@/hooks/useDatasetQueries";
import { useMlReadiness } from "@/context/MlReadinessContext";
import { formatWavelengthUnit } from "@/components/playground/visualizations/chartConfig";
import type { Dataset, PartitionKey } from "@/types/datasets";

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
  const { workspaceReady } = useMlReadiness();
  const [selectedSource, setSelectedSource] = useState(0);
  const [partition, setPartition] = useState<PartitionKey>("all");

  // Preview is fetched via React Query so opening QuickView for a dataset the
  // user has already inspected (in this session) is instant. The hook is also
  // gated on `workspaceReady`, which fixes the "first quickview shows Failed
  // to load dataset" race: previously, opening QuickView before nirs4all had
  // restored the active workspace returned `success: false` from the backend
  // and stuck. The hook now waits for workspaceReady, then runs automatically.
  const {
    data: preview,
    isLoading: queryLoading,
    isFetching,
    error: queryError,
    refetch,
  } = useDatasetPreviewQuery(dataset?.id, 100);
  // Show the spinner only on the very first load for this dataset id; a
  // background refetch (stale-while-revalidate) keeps the previous content
  // visible and avoids flicker on remount.
  const waitingForWorkspace = !!dataset?.id && !workspaceReady && !preview;
  const loading = waitingForWorkspace || queryLoading || (isFetching && !preview);
  const error =
    queryError instanceof Error
      ? queryError.message
      : preview?.error ?? null;
  const loadPreview = () => {
    refetch();
  };

  // Reset per-dataset UI state (selected source, partition) when switching.
  // We intentionally do NOT reset preview/error here — React Query gives us
  // cached data for the new id immediately if available.
  useEffect(() => {
    setSelectedSource(0);
    setPartition("all");
  }, [dataset?.id]);

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
  const histogramData = useMemo(() => buildTargetHistogramData(distribution), [distribution]);

  const headerUnit = preview?.summary?.header_unit;
  const wavelengthUnitSymbol = formatWavelengthUnit(headerUnit);
  const wavelengthUnitSuffix = wavelengthUnitSymbol ? ` ${wavelengthUnitSymbol}` : "";

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

          <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="px-4 pt-2 pb-0 border-b border-border bg-muted/20 flex-shrink-0">
              <TabsList className="w-full grid grid-cols-3 bg-transparent h-10 p-0 border-none">
                <TabsTrigger
                  value="overview"
                  className="data-[state=active]:bg-background data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:rounded-none rounded-none border-b-2 border-transparent h-full px-4 text-sm font-medium"
                >
                  Overview
                </TabsTrigger>
                <TabsTrigger
                  value="spectra"
                  className="data-[state=active]:bg-background data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:rounded-none rounded-none border-b-2 border-transparent h-full px-4 text-sm font-medium"
                >
                  Spectra
                </TabsTrigger>
                <TabsTrigger
                  value="targets"
                  className="data-[state=active]:bg-background data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:rounded-none rounded-none border-b-2 border-transparent h-full px-4 text-sm font-medium"
                >
                  Targets & Labels
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 min-h-0 relative">
              <ScrollArea className="absolute inset-0 h-full w-full">
                <div className="p-4 space-y-4">
                  <TabsContent value="overview" className="m-0 mt-0 space-y-3 p-4 outline-none overflow-y-auto h-full">
              {loading && (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                  <p className="text-muted-foreground text-sm">
                    {waitingForWorkspace ? "Loading workspace..." : "Loading preview..."}
                  </p>
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
                      <div className="grid grid-cols-2 gap-3">
                        <Card className="border-0 shadow-none bg-muted/20">
                          <CardHeader className="pb-2 pt-3 px-3">
                            <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
                              <Target className="h-3.5 w-3.5" /> Targets & Types
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="px-3 pb-3">
                            <p className="font-semibold text-sm capitalize mb-1">{dataset.task_type || 'auto'}</p>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {dataset.targets && dataset.targets.length > 0 ? (
                                dataset.targets.map((target) => (
                                  <Badge key={target.column} variant={target.column === dataset.default_target ? 'default' : 'outline'} className="text-[10px]">
                                    {target.column}{target.unit && ` (${target.unit})`}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">No targets</span>
                              )}
                            </div>
                          </CardContent>
                        </Card>

                        <Card className="border-0 shadow-none bg-muted/20">
                          <CardHeader className="pb-2 pt-3 px-3">
                            <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
                              <Hash className="h-3.5 w-3.5" /> Metadata Fields
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="px-3 pb-3">
                            <p className="font-semibold text-sm mb-1">{preview?.summary.n_metadata || 0} fields</p>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {preview?.summary.metadata_cols?.length > 0 ? (
                                preview.summary.metadata_cols.slice(0, 5).map((col) => (
                                  <Badge key={col} variant="secondary" className="text-[10px] bg-background/50">{col}</Badge>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">None</span>
                              )}
                              {preview?.summary.metadata_cols?.length > 5 && (
                                <span className="text-[10px] text-muted-foreground ml-1">+{preview.summary.metadata_cols.length - 5} more</span>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </div>

                      <Card className="border-0 shadow-none bg-muted/20">
                        <CardHeader className="pb-2 pt-3 px-3">
                          <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
                            <Layers className="h-3.5 w-3.5" /> Spectral Properties
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-3 pb-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-0.5">
                                {wavelengthUnitSymbol === 'cm⁻¹' ? 'Wavenumber Range' : 'Wavelength Range'}
                              </p>
                              <p className="text-sm font-semibold">
                                {spectraData
                                  ? `${Math.min(...spectraData.wavelengths).toFixed(0)} - ${Math.max(...spectraData.wavelengths).toFixed(0)}${wavelengthUnitSuffix}`
                                  : '--'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-0.5">Resolution</p>
                              <p className="text-sm font-semibold">
                                {spectraData && spectraData.wavelengths.length > 1
                                  ? `${((Math.max(...spectraData.wavelengths) - Math.min(...spectraData.wavelengths)) / (spectraData.wavelengths.length - 1)).toFixed(2)}${wavelengthUnitSuffix}`
                                  : '--'}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-0 shadow-sm border-border">
                        <CardHeader className="pb-2 pt-3 px-3 border-b border-border/50">
                          <CardTitle className="text-xs text-muted-foreground">Dataset Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 px-3 py-3">
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-0.5">Original Data Path</p>
                            <p className="font-mono text-[11px] truncate break-all" title={dataset.path}>{dataset.path}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-0.5">Storage Location</p>
                            <p className="font-mono text-[11px] truncate break-all" title={dataset.storage_path}>{dataset.storage_path}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {dataset.version && (
                              <div>
                                <p className="text-[10px] text-muted-foreground mb-0.5">Version</p>
                                <p className="text-xs font-medium">{dataset.version}</p>
                              </div>
                            )}
                            {dataset.hash && (
                              <div>
                                <p className="text-[10px] text-muted-foreground mb-0.5">File Hash</p>
                                <p className="font-mono text-[11px] truncate" title={dataset.hash}>{dataset.hash.substring(0, 16)}...</p>
                              </div>
                            )}
                            {dataset.last_verified && (
                              <div>
                                <p className="text-[10px] text-muted-foreground mb-0.5">Last Verified</p>
                                <p className="text-xs font-mono">{new Date(dataset.last_verified).toLocaleDateString()}</p>
                              </div>
                            )}
                          </div>
                          {dataset.description && (
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-0.5">Description</p>
                              <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{dataset.description}</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </>
                  )}
                  </TabsContent>

                  <TabsContent value="spectra" className="m-0 mt-0 h-full min-h-[400px] outline-none">
                    {!loading && !error && (
                      <Card className="flex flex-col border-0 shadow-none">

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
                          width="100%"
                          height={260}
                          unit={headerUnit}
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
                    )}
                  </TabsContent>

                  <TabsContent value="targets" className="m-0 mt-0 h-full outline-none">
                    {!loading && !error && (
                      <Card className="flex flex-col border-0 shadow-none">

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
                            {histogramData.length > 0 ? (
                              <TargetHistogram
                                data={histogramData}
                                type={distribution.type}
                                width="100%"
                                height={200}
                                barColor={partitionTheme.histogramColor}
                              />
                            ) : (
                              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg">
                                No distribution chart available
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
                    )}
                  </TabsContent>
                </div>
              </ScrollArea>
            </div>
          </Tabs>

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
