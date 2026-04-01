import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, BarChart3, Download, RotateCcw, Table as TableIcon } from "lucide-react";

import { exportDataAsCSV } from "@/lib/chartExport";
import { getPredictionMetricLabel } from "@/lib/predict-metrics";
import { formatMetricName, formatMetricValue } from "@/lib/scores";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PredictResponse } from "@/types/predict";

interface PredictResultsProps {
  result: PredictResponse;
  onReset: () => void;
}

function computeStats(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((accumulator, value) => accumulator + value, 0);
  const mean = sum / count;
  const variance =
    sorted.reduce((accumulator, value) => accumulator + (value - mean) ** 2, 0) / count;
  const std = Math.sqrt(variance);
  const median =
    count % 2 === 0
      ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
      : sorted[Math.floor(count / 2)];
  const q1 = sorted[Math.floor(count * 0.25)];
  const q3 = sorted[Math.floor(count * 0.75)];

  return {
    count,
    mean,
    std,
    min: sorted[0],
    q1,
    median,
    q3,
    max: sorted[count - 1],
  };
}

function buildHistogram(values: number[], numBins = 20) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) {
    return [{ binLabel: formatMetricValue(min), count: values.length }];
  }

  const binWidth = range / numBins;
  const bins = Array.from({ length: numBins }, (_, index) => ({
    binLabel: formatMetricValue(min + binWidth * (index + 0.5)),
    count: 0,
  }));

  for (const value of values) {
    const index = Math.min(Math.floor((value - min) / binWidth), numBins - 1);
    bins[index].count += 1;
  }

  return bins;
}

function getMetricLabel(metric: string): string {
  const normalized = metric.toLowerCase();
  if (normalized === "rmse" || normalized === "rmsep") {
    return getPredictionMetricLabel(normalized);
  }
  if (normalized === "r2") return "R²";
  return formatMetricName(normalized);
}

export function PredictResults({ result, onReset }: PredictResultsProps) {
  const { t } = useTranslation();

  const hasActuals = result.actual_values != null && result.actual_values.length > 0;
  const hasMetrics = result.metrics != null;

  const tableData = useMemo(
    () =>
      result.predictions.map((prediction, index) => ({
        index: result.sample_ids?.[index] ?? index + 1,
        predicted: prediction,
        actual: hasActuals ? result.actual_values![index] : undefined,
        residual: hasActuals ? result.actual_values![index] - prediction : undefined,
      })),
    [hasActuals, result],
  );

  const metricEntries = useMemo(() => {
    if (!result.metrics) return [];

    const priority = ["rmsep", "rmse", "r2", "mae", "rpd", "sep", "bias"];
    const seen = new Set<string>();
    const ordered = [];

    for (const key of priority) {
      const alias = key === "rmsep" ? "rmse" : key;
      const value = result.metrics[alias];
      if (value == null || seen.has(alias)) continue;
      seen.add(alias);
      ordered.push({ key: alias, value });
    }

    for (const [key, value] of Object.entries(result.metrics)) {
      if (value == null || seen.has(key)) continue;
      seen.add(key);
      ordered.push({ key, value });
    }

    return ordered;
  }, [result.metrics]);

  const scatterData = useMemo(() => {
    if (!hasActuals) return [];
    return result.predictions.map((prediction, index) => ({
      actual: result.actual_values![index],
      predicted: prediction,
    }));
  }, [hasActuals, result.actual_values, result.predictions]);

  const predictionStats = useMemo(() => computeStats(result.predictions), [result.predictions]);
  const histogramData = useMemo(() => buildHistogram(result.predictions), [result.predictions]);

  const summaryMetric = metricEntries[0] ?? null;

  const scatterRange = useMemo(() => {
    if (!hasActuals) return { min: 0, max: 1 };
    const values = [...result.predictions, ...result.actual_values!];
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [hasActuals, result.actual_values, result.predictions]);

  const handleExportCSV = () => {
    const rows = tableData.map((row) => {
      const record: Record<string, number | string> = {
        sample: String(row.index),
        predicted: row.predicted,
      };

      if (row.actual !== undefined) record.actual = row.actual;
      if (row.residual !== undefined) record.residual = row.residual;

      return record;
    });

    exportDataAsCSV(rows, `predictions_${result.model_name}`);
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>{t("predict.results.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("predict.results.summary", {
                count: result.num_samples,
                model: result.model_name,
              })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportCSV}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t("predict.results.export.csv")}
            </Button>
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              {t("predict.results.newPrediction")}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Samples</p>
            <p className="mt-2 text-2xl font-semibold">{result.num_samples}</p>
            <p className="mt-1 text-sm text-muted-foreground">Predictions in this run</p>
          </div>

          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Reference values</p>
            <p className="mt-2 text-2xl font-semibold">{hasActuals ? "Available" : "Missing"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasActuals
                ? "Prediction quality metrics are computed from the visible output."
                : "Upload data with targets or run on a dataset partition to compute RMSEP."}
            </p>
          </div>

          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {summaryMetric ? getMetricLabel(summaryMetric.key) : "Prediction metric"}
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {summaryMetric ? formatMetricValue(summaryMetric.value, summaryMetric.key) : "—"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {summaryMetric
                ? "Primary metric for this prediction result"
                : "No comparable score available for this input"}
            </p>
          </div>
        </div>

        {result.preprocessing_steps.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {result.preprocessing_steps.map((step) => (
              <Badge key={step} variant="outline" className="text-xs">
                {step}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {hasMetrics && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metricEntries.map(({ key, value }) => (
              <div key={key} className="rounded-xl border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {getMetricLabel(key)}
                </p>
                <p className="mt-2 text-xl font-semibold">{formatMetricValue(value, key)}</p>
              </div>
            ))}
          </div>
        )}

        {predictionStats && (
          <div className="rounded-xl border bg-muted/20 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Predicted distribution
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4 xl:grid-cols-8">
              {([
                ["N", predictionStats.count],
                ["Mean", predictionStats.mean],
                ["Std", predictionStats.std],
                ["Min", predictionStats.min],
                ["Q1", predictionStats.q1],
                ["Median", predictionStats.median],
                ["Q3", predictionStats.q3],
                ["Max", predictionStats.max],
              ] as [string, number][]).map(([label, value]) => (
                <div key={label} className="rounded-lg bg-background p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-1 text-sm font-medium">
                    {label === "N" ? value : formatMetricValue(value)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <Tabs defaultValue="table">
          <TabsList>
            <TabsTrigger value="table" className="gap-1.5">
              <TableIcon className="h-3.5 w-3.5" />
              {t("predict.results.tabs.table")}
            </TabsTrigger>
            <TabsTrigger value="distribution" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Distribution
            </TabsTrigger>
            {hasActuals && (
              <TabsTrigger value="chart" className="gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />
                {t("predict.results.tabs.chart")}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="table" className="mt-3">
            <div className="max-h-[420px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">
                      {t("predict.results.table.sample")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("predict.results.table.predicted")}
                    </TableHead>
                    {hasActuals && (
                      <>
                        <TableHead className="text-right">
                          {t("predict.results.table.actual")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("predict.results.table.residual")}
                        </TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableData.map((row, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-mono text-xs">{String(row.index)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatMetricValue(row.predicted)}
                      </TableCell>
                      {hasActuals && (
                        <>
                          <TableCell className="text-right font-mono text-sm">
                            {row.actual !== undefined ? formatMetricValue(row.actual) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {row.residual !== undefined ? formatMetricValue(row.residual) : "—"}
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="distribution" className="mt-3">
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogramData} margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="binLabel"
                    tick={{ fontSize: 10 }}
                    interval="preserveStartEnd"
                    label={{
                      value: t("predict.results.table.predicted", { defaultValue: "Predicted" }),
                      position: "bottom",
                      offset: 15,
                      fontSize: 12,
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    label={{
                      value: "Count",
                      angle: -90,
                      position: "insideLeft",
                      offset: -5,
                      fontSize: 12,
                    }}
                  />
                  <RechartsTooltip
                    formatter={(value: number) => [value, "Count"]}
                    labelFormatter={(label) => `Value: ${label}`}
                  />
                  <Bar
                    dataKey="count"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.75}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>

          {hasActuals && (
            <TabsContent value="chart" className="mt-3">
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis
                      type="number"
                      dataKey="actual"
                      name="Actual"
                      domain={[scatterRange.min, scatterRange.max]}
                      tick={{ fontSize: 11 }}
                      label={{
                        value: t("predict.results.table.actual"),
                        position: "bottom",
                        offset: 15,
                        fontSize: 12,
                      }}
                    />
                    <YAxis
                      type="number"
                      dataKey="predicted"
                      name="Predicted"
                      domain={[scatterRange.min, scatterRange.max]}
                      tick={{ fontSize: 11 }}
                      label={{
                        value: t("predict.results.table.predicted"),
                        angle: -90,
                        position: "insideLeft",
                        offset: -5,
                        fontSize: 12,
                      }}
                    />
                    <RechartsTooltip formatter={(value: number) => formatMetricValue(value)} />
                    <ReferenceLine
                      segment={[
                        { x: scatterRange.min, y: scatterRange.min },
                        { x: scatterRange.max, y: scatterRange.max },
                      ]}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="5 5"
                      strokeOpacity={0.5}
                    />
                    <Scatter
                      data={scatterData}
                      fill="hsl(var(--primary))"
                      fillOpacity={0.65}
                      r={4}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}
