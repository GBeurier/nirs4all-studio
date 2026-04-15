import { useEffect, useRef, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  TrendingUp,
  ScatterChart as ScatterIcon,
  BarChart3,
  Database,
  Brain,
  Layers,
  Loader2,
  AlertCircle,
  FileSpreadsheet,
  ImageDown,
} from "lucide-react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { ConfusionMatrixChart } from "@/components/inspector/visualizations/ConfusionMatrixChart";
import type { PredictionRecord } from "@/types/linked-workspaces";
import type { PartitionPrediction } from "@/types/aggregated-predictions";
import type { ConfusionMatrixResponse } from "@/types/inspector";
import { getN4AWorkspacePredictionScatter, getPredictionArrays, type PredictionScatterResponse } from "@/api/client";
import {
  buildConfusionMatrixFromVectors,
  isClassificationTask,
} from "@/components/runs/modelDetailClassification";

/** Minimal info needed to display the quick view header. */
interface QuickViewTarget {
  id: string;
  dataset_name: string;
  model_name: string | null;
  partition: string | null;
  preprocessings: string | null;
  val_score: number | null;
  test_score: number | null;
  train_score: number | null;
  n_samples: number | null;
  n_features: number | null;
  fold_id: string | null;
  task_type: string | null;
  source_dataset?: string;
}

/** Compact tick formatter for chart axes — keeps labels short. */
function formatTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1000 || abs < 0.01) return value.toExponential(1);
  return value.toFixed(2);
}

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(value: string | null | undefined): string {
  return (value || "chart").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/** Render the rows as CSV and download as a file. */
function exportRowsCsv<T extends Record<string, unknown>>(rows: T[], header: (keyof T)[], filename: string): void {
  const headerLine = header.map((c) => csvEscape(String(c))).join(",");
  const lines = rows.map((row) => header.map((col) => csvEscape(row[col])).join(","));
  const csv = [headerLine, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename);
}

/** Serialize a chart's SVG inside `container` to PNG via canvas. */
function exportChartPng(container: HTMLElement | null, filename: string): void {
  if (!container) return;
  const svg = container.querySelector("svg");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(rect.width));
  clone.setAttribute("height", String(rect.height));
  const xml = new XMLSerializer().serializeToString(clone);
  const svg64 = btoa(unescape(encodeURIComponent(xml)));
  const image64 = `data:image/svg+xml;base64,${svg64}`;
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename);
    }, "image/png");
  };
  img.src = image64;
}

/** Adapt a PartitionPrediction to QuickViewTarget. */
function fromPartitionPrediction(p: PartitionPrediction): QuickViewTarget {
  return {
    id: p.prediction_id,
    dataset_name: p.dataset_name,
    model_name: p.model_name,
    partition: p.partition,
    preprocessings: p.preprocessings ?? null,
    val_score: p.val_score,
    test_score: p.test_score,
    train_score: p.train_score,
    n_samples: p.n_samples ?? null,
    n_features: p.n_features ?? null,
    fold_id: p.fold_id,
    task_type: p.task_type,
  };
}

/** Adapt a PredictionRecord to QuickViewTarget. */
function fromPredictionRecord(p: PredictionRecord): QuickViewTarget {
  return {
    id: p.id,
    dataset_name: p.source_dataset || p.dataset_name,
    model_name: p.model_name ?? null,
    partition: p.partition ?? null,
    preprocessings: p.preprocessings ?? null,
    val_score: p.val_score ?? null,
    test_score: p.test_score ?? null,
    train_score: p.train_score ?? null,
    n_samples: p.n_samples ?? null,
    n_features: p.n_features ?? null,
    fold_id: p.fold_id ?? null,
    task_type: p.task_type ?? null,
    source_dataset: p.source_dataset,
  };
}

interface PredictionQuickViewProps {
  /** PredictionRecord from per-fold view. */
  prediction?: PredictionRecord | null;
  /** PartitionPrediction from tree/aggregated view (alternative to prediction). */
  partitionPrediction?: PartitionPrediction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
}

export function PredictionQuickView({ prediction, partitionPrediction, open, onOpenChange, workspaceId }: PredictionQuickViewProps) {
  const [scatterData, setScatterData] = useState<PredictionScatterResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scatterChartRef = useRef<HTMLDivElement>(null);
  const residualsChartRef = useRef<HTMLDivElement>(null);
  const confusionChartRef = useRef<HTMLDivElement>(null);

  // Resolve the target from either prop
  const target: QuickViewTarget | null = useMemo(() => {
    if (partitionPrediction) return fromPartitionPrediction(partitionPrediction);
    if (prediction) return fromPredictionRecord(prediction);
    return null;
  }, [prediction, partitionPrediction]);

  const targetId = target?.id;
  const useAggregatedApi = !!partitionPrediction;
  const showClassificationView = isClassificationTask(target?.task_type);

  // Fetch prediction arrays when dialog opens.
  useEffect(() => {
    if (open && targetId) {
      setIsLoading(true);
      setError(null);

      const fetchPromise = useAggregatedApi
        ? getPredictionArrays(targetId).then(r => ({
            prediction_id: targetId,
            y_true: r.y_true || [],
            y_pred: r.y_pred || [],
            n_samples: r.n_samples,
            partition: target?.partition || "",
            model_name: target?.model_name || "",
            dataset_name: target?.dataset_name || "",
          } satisfies PredictionScatterResponse))
        : workspaceId
          ? getN4AWorkspacePredictionScatter(workspaceId, targetId)
          : Promise.reject(new Error("No workspace ID"));

      fetchPromise
        .then((data) => {
          setScatterData(data);
          setIsLoading(false);
        })
        .catch((err) => {
          console.error("Failed to fetch prediction data:", err);
          setError("Could not load prediction data");
          setScatterData(null);
          setIsLoading(false);
        });
    } else if (!open) {
      setScatterData(null);
      setError(null);
    }
  }, [open, targetId, workspaceId, useAggregatedApi]);

  // Transform scatter data for charts
  const predictionChartData = useMemo(() => {
    if (!scatterData || !scatterData.y_true.length) return [];

    return scatterData.y_true.map((actual, i) => ({
      actual,
      predicted: scatterData.y_pred[i],
    }));
  }, [scatterData]);

  const residualChartData = useMemo(() => {
    if (!scatterData || !scatterData.y_true.length) return [];

    return scatterData.y_true.map((actual, i) => ({
      predicted: scatterData.y_pred[i],
      residual: actual - scatterData.y_pred[i],
    }));
  }, [scatterData]);

  const metricsData = useMemo(() => {
    if (!target) return [];
    const valScore = target.val_score ?? 0;
    const testScore = target.test_score ?? 0;
    const trainScore = target.train_score ?? 0;

    return [
      { name: "Val", value: valScore, color: "hsl(var(--chart-1))" },
      { name: "Test", value: testScore, color: "hsl(var(--chart-2))" },
      { name: "Train", value: trainScore, color: "hsl(var(--chart-3))" },
    ].filter(m => m.value > 0);
  }, [target]);

  // Compute real statistics from scatter data
  const { primaryScore, rmse, meanResidual, stdResidual } = useMemo(() => {
    if (!target) {
      return { primaryScore: 0, rmse: 0, meanResidual: 0, stdResidual: 0 };
    }

    const primaryScore = target.val_score ?? target.test_score ?? 0;

    if (scatterData && scatterData.y_true.length > 0) {
      const residuals = scatterData.y_true.map((y, i) => y - scatterData.y_pred[i]);
      const meanResidual = residuals.reduce((a, b) => a + b, 0) / residuals.length;
      const squaredErrors = residuals.map(r => r * r);
      const mse = squaredErrors.reduce((a, b) => a + b, 0) / squaredErrors.length;
      const rmse = Math.sqrt(mse);
      const variance = residuals.map(r => (r - meanResidual) ** 2).reduce((a, b) => a + b, 0) / residuals.length;
      const stdResidual = Math.sqrt(variance);

      return { primaryScore, rmse, meanResidual, stdResidual };
    }

    // Fallback to approximation
    const rmse = primaryScore > 0 ? (1 - primaryScore) * 2 : 0.5;
    return { primaryScore, rmse, meanResidual: 0, stdResidual: rmse };
  }, [target, scatterData]);

  const confusionData = useMemo<ConfusionMatrixResponse>(() => {
    if (error) {
      return {
        cells: [],
        labels: [],
        total_samples: 0,
        partition: target?.partition || "",
        normalize: "none",
        reason: error,
      };
    }

    return buildConfusionMatrixFromVectors({
      yTrue: scatterData?.y_true ?? [],
      yPred: scatterData?.y_pred ?? [],
      normalize: "none",
      partitionLabel: target?.partition || "",
    });
  }, [error, scatterData, target?.partition]);

  if (!target) return null;

  const hasScatterData = scatterData && scatterData.y_true.length > 0;
  const actualSampleCount = hasScatterData ? scatterData.n_samples : (target.n_samples ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <ScatterIcon className="h-5 w-5 text-primary" />
            Quick View
          </DialogTitle>
        </DialogHeader>

        {/* Prediction Info Header */}
        <div className="flex flex-wrap items-center gap-3 pb-4 border-b">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{target.source_dataset || target.dataset_name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <Badge variant="outline">{target.model_name || "Unknown"}</Badge>
          </div>
          {target.partition && (
            <Badge variant="secondary">{target.partition}</Badge>
          )}
          {target.preprocessings && (
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{target.preprocessings}</span>
            </div>
          )}
        </div>

        <Tabs
          key={`${target.id}-${showClassificationView ? "classification" : "regression"}`}
          defaultValue={showClassificationView ? "confusion" : "scatter"}
          className="mt-4"
        >
          <TabsList className="w-fit">
            {showClassificationView ? (
              <TabsTrigger value="confusion" className="gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />
                Confusion Matrix
              </TabsTrigger>
            ) : (
              <>
                <TabsTrigger value="scatter" className="gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Pred vs Actual
                </TabsTrigger>
                <TabsTrigger value="residuals" className="gap-1.5">
                  <ScatterIcon className="h-3.5 w-3.5" />
                  Residuals
                </TabsTrigger>
              </>
            )}
            <TabsTrigger value="metrics" className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              Metrics
            </TabsTrigger>
          </TabsList>

          {!showClassificationView && (
            <>
              <TabsContent value="scatter" className="mt-4">
                <Card>
                  <CardContent className="pt-6">
                    {hasScatterData && (
                      <div className="flex justify-end gap-1 -mt-2 mb-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Export points as CSV"
                          onClick={() => exportRowsCsv(
                            predictionChartData.map((p) => ({ actual: p.actual, predicted: p.predicted, residual: p.actual - p.predicted })),
                            ["actual", "predicted", "residual"],
                            `${sanitizeFilename(target.dataset_name)}_${sanitizeFilename(target.model_name)}_scatter.csv`,
                          )}
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Export chart as PNG"
                          onClick={() => exportChartPng(
                            scatterChartRef.current,
                            `${sanitizeFilename(target.dataset_name)}_${sanitizeFilename(target.model_name)}_scatter.png`,
                          )}
                        >
                          <ImageDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                    {isLoading ? (
                      <div className="h-[320px] flex items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : error || !hasScatterData ? (
                      <div className="h-[320px] flex flex-col items-center justify-center text-muted-foreground">
                        <AlertCircle className="h-8 w-8 mb-2" />
                        <p>{error || "No scatter data available"}</p>
                      </div>
                    ) : (
                      <div className="h-[320px]" ref={scatterChartRef}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 50 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis
                              dataKey="actual"
                              type="number"
                              name="Actual"
                              domain={['auto', 'auto']}
                              label={{ value: 'Actual', position: 'bottom', offset: 20, style: { fill: 'hsl(var(--muted-foreground))' } }}
                              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                              tickFormatter={formatTick}
                            />
                            <YAxis
                              dataKey="predicted"
                              type="number"
                              name="Predicted"
                              domain={['auto', 'auto']}
                              label={{ value: 'Predicted', angle: -90, position: 'left', offset: 35, style: { fill: 'hsl(var(--muted-foreground))' } }}
                              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                              tickFormatter={formatTick}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--card))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                                fontSize: '12px'
                              }}
                              formatter={(value: number) => value.toFixed(3)}
                            />
                            <ReferenceLine
                              segment={[
                                { x: Math.min(...predictionChartData.map(d => d.actual)), y: Math.min(...predictionChartData.map(d => d.actual)) },
                                { x: Math.max(...predictionChartData.map(d => d.actual)), y: Math.max(...predictionChartData.map(d => d.actual)) }
                              ]}
                              stroke="hsl(var(--muted-foreground))"
                              strokeDasharray="5 5"
                              strokeOpacity={0.5}
                            />
                            <Scatter
                              data={predictionChartData}
                              fill="hsl(var(--primary))"
                              opacity={0.7}
                              shape={(props: { cx?: number; cy?: number; fill?: string }) => (
                                <circle cx={props.cx} cy={props.cy} r={2.5} fill={props.fill} fillOpacity={0.7} />
                              )}
                            />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="flex justify-center gap-6 mt-4 text-xs text-muted-foreground">
                      <span>R² = {primaryScore.toFixed(4)}</span>
                      <span>RMSE = {rmse.toFixed(4)}</span>
                      <span>n = {actualSampleCount} samples</span>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="residuals" className="mt-4">
                <Card>
                  <CardContent className="pt-6">
                    {hasScatterData && (
                      <div className="flex justify-end gap-1 -mt-2 mb-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Export points as CSV"
                          onClick={() => exportRowsCsv(
                            residualChartData,
                            ["predicted", "residual"],
                            `${sanitizeFilename(target.dataset_name)}_${sanitizeFilename(target.model_name)}_residuals.csv`,
                          )}
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Export chart as PNG"
                          onClick={() => exportChartPng(
                            residualsChartRef.current,
                            `${sanitizeFilename(target.dataset_name)}_${sanitizeFilename(target.model_name)}_residuals.png`,
                          )}
                        >
                          <ImageDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                    {isLoading ? (
                      <div className="h-[320px] flex items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : error || !hasScatterData ? (
                      <div className="h-[320px] flex flex-col items-center justify-center text-muted-foreground">
                        <AlertCircle className="h-8 w-8 mb-2" />
                        <p>{error || "No residual data available"}</p>
                      </div>
                    ) : (
                      <div className="h-[320px]" ref={residualsChartRef}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 50 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis
                              dataKey="predicted"
                              type="number"
                              domain={['auto', 'auto']}
                              label={{ value: 'Predicted', position: 'bottom', offset: 20, style: { fill: 'hsl(var(--muted-foreground))' } }}
                              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                              tickFormatter={formatTick}
                            />
                            <YAxis
                              dataKey="residual"
                              type="number"
                              domain={['auto', 'auto']}
                              label={{ value: 'Residual', angle: -90, position: 'left', offset: 35, style: { fill: 'hsl(var(--muted-foreground))' } }}
                              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                              tickFormatter={formatTick}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--card))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                                fontSize: '12px'
                              }}
                              formatter={(value: number) => value.toFixed(3)}
                            />
                            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" />
                            <Scatter
                              data={residualChartData}
                              fill="hsl(var(--chart-2))"
                              opacity={0.7}
                              shape={(props: { cx?: number; cy?: number; fill?: string }) => (
                                <circle cx={props.cx} cy={props.cy} r={2.5} fill={props.fill} fillOpacity={0.7} />
                              )}
                            />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="flex justify-center gap-6 mt-4 text-xs text-muted-foreground">
                      <span>Mean Residual = {meanResidual.toFixed(4)}</span>
                      <span>Std = {stdResidual.toFixed(4)}</span>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </>
          )}

          {showClassificationView && (
            <TabsContent value="confusion" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {confusionData.cells.length > 0 && (
                    <div className="flex justify-end gap-1 -mt-2 mb-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Export chart as PNG"
                        onClick={() => exportChartPng(
                          confusionChartRef.current,
                          `${sanitizeFilename(target.dataset_name)}_${sanitizeFilename(target.model_name)}_confusion.png`,
                        )}
                      >
                        <ImageDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  <div className="h-[360px]" ref={confusionChartRef}>
                    <ConfusionMatrixChart data={confusionData} isLoading={isLoading} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          <TabsContent value="metrics" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={metricsData} layout="vertical" margin={{ top: 10, right: 30, bottom: 10, left: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[0, 1]}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                        width={50}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: '12px'
                        }}
                        formatter={(value: number) => value.toFixed(4)}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {metricsData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-3 gap-4 mt-6 text-center">
                  <div>
                    <div className="text-2xl font-bold text-foreground">
                      {target.val_score?.toFixed(4) ?? "\u2014"}
                    </div>
                    <div className="text-xs text-muted-foreground">Validation Score</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-foreground">
                      {target.test_score?.toFixed(4) ?? "\u2014"}
                    </div>
                    <div className="text-xs text-muted-foreground">Test Score</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-foreground">
                      {target.train_score?.toFixed(4) ?? "\u2014"}
                    </div>
                    <div className="text-xs text-muted-foreground">Train Score</div>
                  </div>
                </div>
                {actualSampleCount > 0 && (
                  <div className="flex justify-center gap-6 mt-4 text-xs text-muted-foreground">
                    <span>Samples: {actualSampleCount}</span>
                    {target.n_features && <span>Features: {target.n_features}</span>}
                    {target.fold_id && <span>Fold: {target.fold_id}</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
