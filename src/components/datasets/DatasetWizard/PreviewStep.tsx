/**
 * Step 5: Preview & Confirm
 *
 * Shows:
 * - Dataset summary
 * - Spectra preview chart
 * - Target distribution
 * - Final confirmation
 */
import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Database,
  BarChart3,
  Layers,
  Hash,
  Target,
  Loader2,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWizard } from "./WizardContext";
import { previewDataset, previewDatasetWithUploads } from "@/api/client";
import { SpectraChart, TargetHistogram } from "../charts";
import type { DatasetFile } from "@/types/datasets";

// Alias for backward compatibility in this file
const Histogram = TargetHistogram;

export function PreviewStep() {
  const { state, dispatch } = useWizard();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<number>(0);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    if (state.files.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      // Convert DetectedFile to DatasetFile for API
      const fileConfigs: DatasetFile[] = state.files
        .filter((f) => f.type !== "unknown")
        .map((f) => ({
          path: f.path,
          type: f.type as "X" | "Y" | "metadata",
          split: f.split === "unknown" ? "train" : f.split,
          source: f.source,
          overrides: state.perFileOverrides[f.path],
        }));

      let result;

      // Check if in web mode (no basePath but has fileBlobs)
      const isWebMode = !state.basePath && state.fileBlobs.size > 0;

      if (isWebMode) {
        // Web mode: upload files for preview
        const filesToUpload: File[] = [];
        for (const fileConfig of fileConfigs) {
          const blob = state.fileBlobs.get(fileConfig.path);
          if (blob) {
            filesToUpload.push(blob);
          }
        }

        if (filesToUpload.length === 0) {
          throw new Error("No files available for preview. Please try re-selecting your files.");
        }

        result = await previewDatasetWithUploads(
          filesToUpload,
          fileConfigs,
          state.parsing,
          100
        );
      } else {
        // Desktop mode: use filesystem paths
        result = await previewDataset({
          path: state.basePath,
          files: fileConfigs,
          parsing: state.parsing,
          max_samples: 100,
        });
      }

      dispatch({ type: "SET_PREVIEW", payload: result });

      if (result.error) {
        setError(result.error);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load preview";
      setError(message);
      dispatch({ type: "SET_PREVIEW", payload: null });
    } finally {
      setLoading(false);
    }
  }, [state.files, state.basePath, state.parsing, state.perFileOverrides, state.fileBlobs, dispatch]);

  // Load preview on mount
  useEffect(() => {
    if (!state.preview && !loading) {
      loadPreview();
    }
  }, [loadPreview, state.preview, loading]);

  const preview = state.preview;

  return (
    <div className="flex-1 overflow-auto py-2 space-y-4">
      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Loading dataset preview...</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="flex items-center gap-2 text-destructive mb-4">
            <AlertCircle className="h-8 w-8" />
          </div>
          <p className="text-destructive font-medium mb-2">
            Failed to load preview
          </p>
          <p className="text-sm text-muted-foreground mb-4 max-w-md text-center whitespace-pre-wrap">
            {error}
          </p>
          <div className="flex gap-2">
            <Button onClick={loadPreview} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigator.clipboard.writeText(error)}
              title="Copy error to clipboard"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Preview content */}
      {preview && !loading && !error && (
        <div className="grid grid-cols-2 gap-4">
          {/* Dataset Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Database className="h-4 w-4" />
                Dataset Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="font-medium">{state.datasetName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Layers className="h-3 w-3" /> Samples
                </span>
                <span className="font-medium">
                  {preview.summary.num_samples.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Hash className="h-3 w-3" /> Features
                </span>
                <span className="font-medium">
                  {preview.summary.num_features.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Sources</span>
                <span className="font-medium">{preview.summary.n_sources}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Train/Test</span>
                <span className="font-medium">
                  {preview.summary.train_samples} / {preview.summary.test_samples}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Target className="h-3 w-3" /> Targets
                </span>
                <Badge variant={preview.summary.has_targets ? "default" : "secondary"}>
                  {preview.summary.has_targets
                    ? preview.summary.target_columns?.join(", ") || "Yes"
                    : "None"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Signal Type</span>
                <Badge variant="outline">
                  {preview.summary.signal_type || "auto"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Spectra Preview */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Spectra Preview
                </CardTitle>
                {preview.summary.n_sources > 1 && preview.spectra_per_source && (
                  <Select
                    value={String(selectedSource)}
                    onValueChange={(v) => setSelectedSource(Number(v))}
                  >
                    <SelectTrigger className="w-[140px] h-8">
                      <SelectValue placeholder="Select source" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(preview.spectra_per_source).map((sourceIdx) => (
                        <SelectItem key={sourceIdx} value={sourceIdx}>
                          Source {Number(sourceIdx) + 1}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {(() => {
                // Use per-source data if available and multi-source, otherwise fall back to global
                const spectraData =
                  preview.summary.n_sources > 1 &&
                  preview.spectra_per_source &&
                  preview.spectra_per_source[selectedSource]
                    ? preview.spectra_per_source[selectedSource]
                    : preview.spectra_preview;

                if (spectraData) {
                  return (
                    <SpectraChart
                      wavelengths={spectraData.wavelengths}
                      meanSpectrum={spectraData.mean_spectrum}
                      minSpectrum={spectraData.min_spectrum}
                      maxSpectrum={spectraData.max_spectrum}
                    />
                  );
                }
                return (
                  <div className="h-48 flex items-center justify-center text-muted-foreground">
                    No spectra data available
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Target Distribution */}
          {preview.target_distribution && (
            <Card className="col-span-2">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Target Distribution
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {preview.target_distributions && Object.keys(preview.target_distributions).length > 1 && (
                      <Select
                        value={selectedTarget || ""}
                        onValueChange={(v) => setSelectedTarget(v || null)}
                      >
                        <SelectTrigger className="w-[160px] h-8">
                          <SelectValue placeholder="Select target" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">All (default)</SelectItem>
                          {Object.keys(preview.target_distributions).map((targetName) => (
                            <SelectItem key={targetName} value={targetName}>
                              {targetName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Badge variant="outline">
                      {(() => {
                        const dist = selectedTarget && preview.target_distributions?.[selectedTarget]
                          ? preview.target_distributions[selectedTarget]
                          : preview.target_distribution;
                        return dist?.type || "unknown";
                      })()}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {(() => {
                  // Use selected target data if available, otherwise fall back to global
                  const targetDist = selectedTarget && preview.target_distributions?.[selectedTarget]
                    ? preview.target_distributions[selectedTarget]
                    : preview.target_distribution;

                  if (!targetDist) return null;

                  return (
                    <div className="grid grid-cols-2 gap-4">
                      {targetDist.histogram && (
                        <Histogram
                          data={targetDist.histogram}
                          type={targetDist.type}
                        />
                      )}
                      <div className="space-y-2">
                        {targetDist.type === "regression" && (
                          <>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Min</span>
                              <span>{targetDist.min?.toFixed(3)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Max</span>
                              <span>{targetDist.max?.toFixed(3)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Mean</span>
                              <span>{targetDist.mean?.toFixed(3)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Std</span>
                              <span>{targetDist.std?.toFixed(3)}</span>
                            </div>
                          </>
                        )}
                        {targetDist.type === "classification" && (
                          <>
                            <div className="text-sm">
                              <span className="text-muted-foreground">Classes: </span>
                              {targetDist.classes?.join(", ")}
                            </div>
                            {targetDist.class_counts && (
                              <div className="space-y-1">
                                {Object.entries(targetDist.class_counts).map(
                                  ([cls, count]) => (
                                    <div key={cls} className="flex justify-between text-sm">
                                      <span className="text-muted-foreground">{cls}</span>
                                      <span>{count}</span>
                                    </div>
                                  )
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* Validation Status */}
          <Card className="col-span-2">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                {preview.success ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-medium text-green-600">
                        Dataset is ready to add
                      </p>
                      <p className="text-sm text-muted-foreground">
                        All files parsed successfully. Click "Add Dataset" to continue.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-5 w-5 text-amber-500" />
                    <div>
                      <p className="font-medium text-amber-600">
                        Review warnings before adding
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {preview.error || "Some issues were detected during parsing."}
                      </p>
                    </div>
                  </>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={loadPreview}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Refresh
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
