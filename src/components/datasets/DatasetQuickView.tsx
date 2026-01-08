/**
 * DatasetQuickView - Inline panel for quick dataset preview
 *
 * Shows alongside the dataset list (not as a Sheet overlay).
 * Includes tabs for Spectra, Distribution, and Stats.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { previewDatasetById } from "@/api/client";
import type { Dataset, PreviewDataResponse } from "@/types/datasets";

interface DatasetQuickViewProps {
  dataset: Dataset | null;
  onClose: () => void;
  onEdit?: (dataset: Dataset) => void;
}

/**
 * Format number with locale-aware separators
 */
function formatNumber(num: number | undefined): string {
  if (num === undefined || num === null) return "--";
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

  // Load preview data when dataset changes
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

  // Load preview when dataset changes
  useEffect(() => {
    if (dataset) {
      setPreview(null);
      setError(null);
      loadPreview();
    }
  }, [dataset?.id, loadPreview]);

  if (!dataset) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={dataset.id}
        initial={{ opacity: 0, width: 0 }}
        animate={{ opacity: 1, width: 480 }}
        exit={{ opacity: 0, width: 0 }}
        transition={{ duration: 0.2 }}
        className="flex-shrink-0 h-full overflow-hidden"
      >
        <div className="h-full rounded-xl border border-border bg-card overflow-hidden flex flex-col">
          {/* Header */}
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

          {/* Quick Stats */}
          <div className="grid grid-cols-4 gap-2 p-4 border-b border-border flex-shrink-0">
            <div className="text-center">
              <Layers className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-semibold">{formatNumber(dataset.num_samples)}</p>
              <p className="text-xs text-muted-foreground">Samples</p>
            </div>
            <div className="text-center">
              <Hash className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-semibold">{formatNumber(dataset.num_features)}</p>
              <p className="text-xs text-muted-foreground">Features</p>
            </div>
            <div className="text-center">
              <Target className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-semibold">{dataset.targets?.length || "--"}</p>
              <p className="text-xs text-muted-foreground">Targets</p>
            </div>
            <div className="text-center">
              <Database className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-semibold">{dataset.n_sources || 1}</p>
              <p className="text-xs text-muted-foreground">Sources</p>
            </div>
          </div>

          {/* Tabs Content */}
          <Tabs defaultValue="spectra" className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="mx-4 mt-4 bg-muted/50 flex-shrink-0">
              <TabsTrigger value="spectra" className="text-xs">Spectra</TabsTrigger>
              <TabsTrigger value="distribution" className="text-xs">Distribution</TabsTrigger>
              <TabsTrigger value="stats" className="text-xs">Stats</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 p-4">
              {/* Spectra Tab */}
              <TabsContent value="spectra" className="m-0 mt-0">
                {loading && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                    <p className="text-muted-foreground text-sm">Loading spectra...</p>
                  </div>
                )}

                {error && !loading && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <AlertCircle className="h-8 w-8 text-destructive mb-4" />
                    <p className="text-destructive font-medium mb-2 text-sm">Failed to load</p>
                    <p className="text-xs text-muted-foreground mb-4 text-center">
                      {error}
                    </p>
                    <Button onClick={loadPreview} variant="outline" size="sm">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Retry
                    </Button>
                  </div>
                )}

                {preview?.spectra_preview && !loading && !error && (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Mean spectrum with min/max range</span>
                      <span className="text-xs text-muted-foreground">
                        {preview.spectra_preview.wavelengths.length} points
                      </span>
                    </div>
                    <SpectraChart
                      wavelengths={preview.spectra_preview.wavelengths}
                      meanSpectrum={preview.spectra_preview.mean_spectrum}
                      minSpectrum={preview.spectra_preview.min_spectrum}
                      maxSpectrum={preview.spectra_preview.max_spectrum}
                      width={440}
                      height={280}
                    />
                  </div>
                )}

                {!preview?.spectra_preview && !loading && !error && (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <BarChart3 className="h-8 w-8 mb-4 opacity-50" />
                    <p className="text-sm">No spectra data available</p>
                  </div>
                )}
              </TabsContent>

              {/* Distribution Tab */}
              <TabsContent value="distribution" className="m-0 mt-0">
                {loading && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                    <p className="text-muted-foreground text-sm">Loading distribution...</p>
                  </div>
                )}

                {preview?.target_distribution && !loading && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Target distribution</span>
                      <Badge variant="outline" className="text-xs">
                        {preview.target_distribution.type}
                      </Badge>
                    </div>

                    {preview.target_distribution.histogram && (
                      <TargetHistogram
                        data={preview.target_distribution.histogram}
                        type={preview.target_distribution.type}
                        width={440}
                        height={200}
                      />
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      {preview.target_distribution.type === "regression" && (
                        <>
                          <div className="p-3 bg-muted/30 rounded-lg">
                            <p className="text-xs text-muted-foreground">Min</p>
                            <p className="font-mono font-medium">
                              {preview.target_distribution.min?.toFixed(3)}
                            </p>
                          </div>
                          <div className="p-3 bg-muted/30 rounded-lg">
                            <p className="text-xs text-muted-foreground">Max</p>
                            <p className="font-mono font-medium">
                              {preview.target_distribution.max?.toFixed(3)}
                            </p>
                          </div>
                          <div className="p-3 bg-muted/30 rounded-lg">
                            <p className="text-xs text-muted-foreground">Mean</p>
                            <p className="font-mono font-medium">
                              {preview.target_distribution.mean?.toFixed(3)}
                            </p>
                          </div>
                          <div className="p-3 bg-muted/30 rounded-lg">
                            <p className="text-xs text-muted-foreground">Std Dev</p>
                            <p className="font-mono font-medium">
                              {preview.target_distribution.std?.toFixed(3)}
                            </p>
                          </div>
                        </>
                      )}
                      {preview.target_distribution.type === "classification" &&
                        preview.target_distribution.class_counts && (
                          Object.entries(preview.target_distribution.class_counts).map(
                            ([cls, count]) => (
                              <div key={cls} className="p-3 bg-muted/30 rounded-lg">
                                <p className="text-xs text-muted-foreground">{cls}</p>
                                <p className="font-mono font-medium">{count}</p>
                              </div>
                            )
                          )
                        )}
                    </div>
                  </div>
                )}

                {!preview?.target_distribution && !loading && (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Target className="h-8 w-8 mb-4 opacity-50" />
                    <p className="text-sm">No target data available</p>
                  </div>
                )}
              </TabsContent>

              {/* Stats Tab */}
              <TabsContent value="stats" className="m-0 mt-0">
                <div className="space-y-4">
                  {/* Overview stats */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">Samples</p>
                      <p className="text-xl font-bold">{formatNumber(dataset.num_samples)}</p>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">Features</p>
                      <p className="text-xl font-bold">{formatNumber(dataset.num_features)}</p>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">Spectral Range</p>
                      <p className="text-lg font-bold">
                        {preview?.spectra_preview
                          ? `${Math.min(...preview.spectra_preview.wavelengths).toFixed(0)} - ${Math.max(...preview.spectra_preview.wavelengths).toFixed(0)}`
                          : "--"}
                      </p>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">Targets</p>
                      <p className="text-xl font-bold">{dataset.targets?.length || 0}</p>
                    </div>
                  </div>

                  {/* Target Variables */}
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

                  {/* Metadata */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Task Type</span>
                      <Badge variant="outline" className="capitalize">
                        {dataset.task_type || "auto"}
                      </Badge>
                    </div>
                    {dataset.signal_types && dataset.signal_types.length > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Signal Type</span>
                        <div className="flex gap-1">
                          {dataset.signal_types.map((type) => (
                            <Badge key={type} variant="outline" className="text-xs">
                              {type}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {dataset.is_multi_source && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Multi-source</span>
                        <Badge variant="default">Yes</Badge>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>

          {/* Footer Actions */}
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
              Full Details
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
