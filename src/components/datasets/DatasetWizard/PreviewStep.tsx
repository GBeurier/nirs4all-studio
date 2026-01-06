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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWizard } from "./WizardContext";
import { previewDataset } from "@/api/client";
import type { DatasetFile } from "@/types/datasets";

// Simple line chart for spectra preview
interface SpectraChartProps {
  wavelengths: number[];
  meanSpectrum: number[];
  stdSpectrum?: number[];
  minSpectrum?: number[];
  maxSpectrum?: number[];
}

function SpectraChart({
  wavelengths,
  meanSpectrum,
  stdSpectrum,
  minSpectrum,
  maxSpectrum,
}: SpectraChartProps) {
  // Calculate chart dimensions
  const width = 400;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Scale functions
  const xMin = Math.min(...wavelengths);
  const xMax = Math.max(...wavelengths);
  const allValues = [
    ...meanSpectrum,
    ...(minSpectrum || []),
    ...(maxSpectrum || []),
  ];
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yRange = yMax - yMin || 1;

  const scaleX = (x: number) =>
    padding.left + ((x - xMin) / (xMax - xMin || 1)) * chartWidth;
  const scaleY = (y: number) =>
    padding.top + chartHeight - ((y - yMin) / yRange) * chartHeight;

  // Create path for mean spectrum
  const meanPath = meanSpectrum
    .map((y, i) => `${i === 0 ? "M" : "L"} ${scaleX(wavelengths[i])} ${scaleY(y)}`)
    .join(" ");

  // Create area for min-max range
  let rangePath = "";
  if (minSpectrum && maxSpectrum) {
    const upper = maxSpectrum
      .map((y, i) => `${i === 0 ? "M" : "L"} ${scaleX(wavelengths[i])} ${scaleY(y)}`)
      .join(" ");
    const lower = [...minSpectrum]
      .reverse()
      .map(
        (y, i) =>
          `L ${scaleX(wavelengths[wavelengths.length - 1 - i])} ${scaleY(y)}`
      )
      .join(" ");
    rangePath = `${upper} ${lower} Z`;
  }

  return (
    <svg width={width} height={height} className="w-full h-auto">
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((t) => (
        <line
          key={t}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + chartHeight * t}
          y2={padding.top + chartHeight * t}
          stroke="currentColor"
          strokeOpacity={0.1}
        />
      ))}

      {/* Range area */}
      {rangePath && (
        <path
          d={rangePath}
          fill="hsl(var(--primary))"
          fillOpacity={0.1}
          stroke="none"
        />
      )}

      {/* Mean line */}
      <path
        d={meanPath}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth={2}
      />

      {/* X-axis */}
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={height - padding.bottom}
        y2={height - padding.bottom}
        stroke="currentColor"
        strokeOpacity={0.3}
      />
      <text
        x={width / 2}
        y={height - 5}
        textAnchor="middle"
        className="text-xs fill-muted-foreground"
      >
        Wavelength
      </text>

      {/* Y-axis */}
      <line
        x1={padding.left}
        x2={padding.left}
        y1={padding.top}
        y2={height - padding.bottom}
        stroke="currentColor"
        strokeOpacity={0.3}
      />
    </svg>
  );
}

// Simple histogram for target distribution
interface HistogramProps {
  data: { bin: number; count: number }[];
  type: "regression" | "classification";
}

function Histogram({ data, type }: HistogramProps) {
  const width = 300;
  const height = 150;
  const padding = { top: 10, right: 10, bottom: 25, left: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxCount = Math.max(...data.map((d) => d.count));
  const barWidth = chartWidth / data.length - 2;

  return (
    <svg width={width} height={height} className="w-full h-auto">
      {data.map((d, i) => (
        <rect
          key={i}
          x={padding.left + (chartWidth / data.length) * i + 1}
          y={padding.top + chartHeight * (1 - d.count / maxCount)}
          width={barWidth}
          height={(d.count / maxCount) * chartHeight}
          fill="hsl(var(--primary))"
          fillOpacity={0.7}
          rx={2}
        />
      ))}

      {/* X-axis */}
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={height - padding.bottom}
        y2={height - padding.bottom}
        stroke="currentColor"
        strokeOpacity={0.3}
      />
      <text
        x={width / 2}
        y={height - 5}
        textAnchor="middle"
        className="text-xs fill-muted-foreground"
      >
        {type === "regression" ? "Value" : "Class"}
      </text>
    </svg>
  );
}

export function PreviewStep() {
  const { state, dispatch } = useWizard();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    if (state.files.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      // Convert DetectedFile to DatasetFile for API
      const files: DatasetFile[] = state.files
        .filter((f) => f.type !== "unknown")
        .map((f) => ({
          path: f.path,
          type: f.type as "X" | "Y" | "metadata",
          split: f.split === "unknown" ? "train" : f.split,
          source: f.source,
          overrides: state.perFileOverrides[f.path],
        }));

      const result = await previewDataset({
        path: state.basePath,
        files,
        parsing: state.parsing,
        max_samples: 100,
      });

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
  }, [state.files, state.basePath, state.parsing, state.perFileOverrides, dispatch]);

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
          <p className="text-sm text-muted-foreground mb-4 max-w-md text-center">
            {error}
          </p>
          <Button onClick={loadPreview} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
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
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Spectra Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              {preview.spectra_preview ? (
                <SpectraChart
                  wavelengths={preview.spectra_preview.wavelengths}
                  meanSpectrum={preview.spectra_preview.mean_spectrum}
                  minSpectrum={preview.spectra_preview.min_spectrum}
                  maxSpectrum={preview.spectra_preview.max_spectrum}
                />
              ) : (
                <div className="h-48 flex items-center justify-center text-muted-foreground">
                  No spectra data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Target Distribution */}
          {preview.target_distribution && (
            <Card className="col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Target Distribution
                  <Badge variant="outline" className="ml-2">
                    {preview.target_distribution.type}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  {preview.target_distribution.histogram && (
                    <Histogram
                      data={preview.target_distribution.histogram}
                      type={preview.target_distribution.type}
                    />
                  )}
                  <div className="space-y-2">
                    {preview.target_distribution.type === "regression" && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Min</span>
                          <span>{preview.target_distribution.min?.toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Max</span>
                          <span>{preview.target_distribution.max?.toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Mean</span>
                          <span>{preview.target_distribution.mean?.toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Std</span>
                          <span>{preview.target_distribution.std?.toFixed(3)}</span>
                        </div>
                      </>
                    )}
                    {preview.target_distribution.type === "classification" && (
                      <>
                        <div className="text-sm">
                          <span className="text-muted-foreground">Classes: </span>
                          {preview.target_distribution.classes?.join(", ")}
                        </div>
                        {preview.target_distribution.class_counts && (
                          <div className="space-y-1">
                            {Object.entries(preview.target_distribution.class_counts).map(
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
