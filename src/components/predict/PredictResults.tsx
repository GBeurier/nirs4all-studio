import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Download, RotateCcw, BarChart3, Table as TableIcon } from "lucide-react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMetricValue } from "@/lib/scores";
import { exportDataAsCSV } from "@/lib/chartExport";
import type { PredictResponse } from "@/types/predict";

interface PredictResultsProps {
  result: PredictResponse;
  onReset: () => void;
}

export function PredictResults({ result, onReset }: PredictResultsProps) {
  const { t } = useTranslation();
  const chartRef = useRef<HTMLDivElement>(null);

  const hasActuals = result.actual_values != null && result.actual_values.length > 0;
  const hasMetrics = result.metrics != null;

  const tableData = useMemo(() => {
    return result.predictions.map((pred, i) => ({
      index: result.sample_ids?.[i] ?? i + 1,
      predicted: pred,
      actual: hasActuals ? result.actual_values![i] : undefined,
      residual: hasActuals ? result.actual_values![i] - pred : undefined,
    }));
  }, [result, hasActuals]);

  const scatterData = useMemo(() => {
    if (!hasActuals) return [];
    return result.predictions.map((pred, i) => ({
      actual: result.actual_values![i],
      predicted: pred,
    }));
  }, [result, hasActuals]);

  const handleExportCSV = () => {
    const rows = tableData.map((row) => {
      const r: Record<string, number | string> = {
        sample: String(row.index),
        predicted: row.predicted,
      };
      if (row.actual !== undefined) r.actual = row.actual;
      if (row.residual !== undefined) r.residual = row.residual;
      return r;
    });
    exportDataAsCSV(rows, `predictions_${result.model_name}`);
  };

  // Compute min/max for scatter reference line
  const scatterRange = useMemo(() => {
    if (!hasActuals) return { min: 0, max: 1 };
    const allVals = [...result.predictions, ...result.actual_values!];
    return { min: Math.min(...allVals), max: Math.max(...allVals) };
  }, [result, hasActuals]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t("predict.results.title")}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t("predict.results.summary", {
                count: result.num_samples,
                model: result.model_name,
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportCSV}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {t("predict.results.export.csv")}
            </Button>
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              {t("predict.results.newPrediction")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Preprocessing chain */}
        {result.preprocessing_steps.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {result.preprocessing_steps.map((step, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {step}
              </Badge>
            ))}
          </div>
        )}

        {/* Metrics cards */}
        {hasMetrics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(result.metrics!).map(([key, value]) => (
              <div
                key={key}
                className="rounded-lg border bg-card p-3 text-center"
              >
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {key}
                </p>
                <p className="text-lg font-semibold mt-1">
                  {formatMetricValue(value)}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Table and Chart tabs */}
        <Tabs defaultValue="table">
          <TabsList>
            <TabsTrigger value="table" className="gap-1.5">
              <TableIcon className="h-3.5 w-3.5" />
              {t("predict.results.tabs.table")}
            </TabsTrigger>
            {hasActuals && (
              <TabsTrigger value="chart" className="gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />
                {t("predict.results.tabs.chart")}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="table" className="mt-3">
            <div className="rounded-md border max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">{t("predict.results.table.sample")}</TableHead>
                    <TableHead className="text-right">{t("predict.results.table.predicted")}</TableHead>
                    {hasActuals && (
                      <>
                        <TableHead className="text-right">{t("predict.results.table.actual")}</TableHead>
                        <TableHead className="text-right">{t("predict.results.table.residual")}</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableData.map((row, i) => (
                    <TableRow key={i}>
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

          {hasActuals && (
            <TabsContent value="chart" className="mt-3">
              <div ref={chartRef} className="w-full h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis
                      type="number"
                      dataKey="actual"
                      name="Actual"
                      domain={[scatterRange.min, scatterRange.max]}
                      tick={{ fontSize: 11 }}
                      label={{ value: t("predict.results.table.actual"), position: "bottom", offset: 15, fontSize: 12 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="predicted"
                      name="Predicted"
                      domain={[scatterRange.min, scatterRange.max]}
                      tick={{ fontSize: 11 }}
                      label={{ value: t("predict.results.table.predicted"), angle: -90, position: "insideLeft", offset: -5, fontSize: 12 }}
                    />
                    <RechartsTooltip
                      formatter={(value: number) => formatMetricValue(value)}
                    />
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
                      fillOpacity={0.6}
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
