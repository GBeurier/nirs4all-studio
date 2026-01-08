import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  TrendingUp,
  LineChart as LineChartIcon,
  ScatterChart as ScatterIcon,
  BarChart3,
  Database,
  Brain,
  Layers,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import type { PredictionRecord } from "@/types/linked-workspaces";

interface PredictionQuickViewProps {
  prediction: PredictionRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Generate mock prediction scatter data based on prediction metrics
const generatePredictionData = (prediction: PredictionRecord) => {
  const score = prediction.val_score ?? prediction.test_score ?? 0.8;
  const errorScale = 1 - score;
  const baseValue = 10 + Math.random() * 5;

  return Array.from({ length: 50 }, () => {
    const actual = baseValue + Math.random() * 10;
    const noise = (Math.random() - 0.5) * errorScale * 4;
    return { actual, predicted: actual + noise };
  });
};

// Generate residual data
const generateResidualData = (prediction: PredictionRecord) => {
  const score = prediction.val_score ?? prediction.test_score ?? 0.8;
  const errorScale = 1 - score;

  return Array.from({ length: 50 }, () => {
    const predicted = 10 + Math.random() * 10;
    const residual = (Math.random() - 0.5) * errorScale * 4;
    return { predicted, residual };
  });
};

// Generate component optimization curve (for models like PLS)
const generateComponentData = (prediction: PredictionRecord) => {
  const maxScore = prediction.val_score ?? prediction.test_score ?? 0.9;
  const optimalComponents = 8 + Math.floor(Math.random() * 5);

  return Array.from({ length: 15 }, (_, i) => {
    const components = i + 1;
    const progress = Math.min(1, components / optimalComponents);
    const r2_train = 0.5 + progress * 0.48 + (components > optimalComponents ? 0.015 : 0);
    const r2_cv = 0.45 + progress * 0.55 * maxScore - (components > optimalComponents ? (components - optimalComponents) * 0.004 : 0);
    return {
      components,
      r2_train: Math.min(0.99, r2_train),
      r2_cv: Math.max(0.4, Math.min(maxScore, r2_cv))
    };
  });
};

export function PredictionQuickView({ prediction, open, onOpenChange }: PredictionQuickViewProps) {
  const predictionData = useMemo(
    () => prediction ? generatePredictionData(prediction) : [],
    [prediction]
  );

  const residualData = useMemo(
    () => prediction ? generateResidualData(prediction) : [],
    [prediction]
  );

  const componentData = useMemo(
    () => prediction ? generateComponentData(prediction) : [],
    [prediction]
  );

  const metricsData = useMemo(() => {
    if (!prediction) return [];
    const valScore = prediction.val_score ?? 0;
    const testScore = prediction.test_score ?? 0;
    const trainScore = prediction.train_score ?? 0;

    return [
      { name: "Val", value: valScore, color: "hsl(var(--chart-1))" },
      { name: "Test", value: testScore, color: "hsl(var(--chart-2))" },
      { name: "Train", value: trainScore, color: "hsl(var(--chart-3))" },
    ].filter(m => m.value > 0);
  }, [prediction]);

  if (!prediction) return null;

  const primaryScore = prediction.val_score ?? prediction.test_score ?? 0;
  const rmse = primaryScore > 0 ? (1 - primaryScore) * 2 : 0.5; // Approximate RMSE from score

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
            <span className="font-medium">{prediction.source_dataset || prediction.dataset_name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <Badge variant="outline">{prediction.model_name || "Unknown"}</Badge>
          </div>
          {prediction.partition && (
            <Badge variant="secondary">{prediction.partition}</Badge>
          )}
          {prediction.preprocessings && (
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{prediction.preprocessings}</span>
            </div>
          )}
        </div>

        <Tabs defaultValue="scatter" className="mt-4">
          <TabsList className="w-fit">
            <TabsTrigger value="scatter" className="gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              Pred vs Actual
            </TabsTrigger>
            <TabsTrigger value="residuals" className="gap-1.5">
              <ScatterIcon className="h-3.5 w-3.5" />
              Residuals
            </TabsTrigger>
            <TabsTrigger value="components" className="gap-1.5">
              <LineChartIcon className="h-3.5 w-3.5" />
              Components
            </TabsTrigger>
            <TabsTrigger value="metrics" className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              Metrics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scatter" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <div className="h-[320px]">
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
                      />
                      <YAxis
                        dataKey="predicted"
                        type="number"
                        name="Predicted"
                        domain={['auto', 'auto']}
                        label={{ value: 'Predicted', angle: -90, position: 'left', offset: 35, style: { fill: 'hsl(var(--muted-foreground))' } }}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
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
                          { x: Math.min(...predictionData.map(d => d.actual)), y: Math.min(...predictionData.map(d => d.actual)) },
                          { x: Math.max(...predictionData.map(d => d.actual)), y: Math.max(...predictionData.map(d => d.actual)) }
                        ]}
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="5 5"
                        strokeOpacity={0.5}
                      />
                      <Scatter
                        data={predictionData}
                        fill="hsl(var(--primary))"
                        opacity={0.7}
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-6 mt-4 text-xs text-muted-foreground">
                  <span>Score = {primaryScore.toFixed(3)}</span>
                  <span>RMSE ≈ {rmse.toFixed(3)}</span>
                  <span>n = {prediction.n_samples ?? 50} samples</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="residuals" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 50 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis
                        dataKey="predicted"
                        type="number"
                        domain={['auto', 'auto']}
                        label={{ value: 'Predicted', position: 'bottom', offset: 20, style: { fill: 'hsl(var(--muted-foreground))' } }}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      />
                      <YAxis
                        dataKey="residual"
                        type="number"
                        domain={['auto', 'auto']}
                        label={{ value: 'Residual', angle: -90, position: 'left', offset: 35, style: { fill: 'hsl(var(--muted-foreground))' } }}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
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
                        data={residualData}
                        fill="hsl(var(--chart-2))"
                        opacity={0.7}
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-6 mt-4 text-xs text-muted-foreground">
                  <span>Mean Residual ≈ 0</span>
                  <span>Std ≈ {rmse.toFixed(3)}</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="components" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={componentData} margin={{ top: 10, right: 20, bottom: 40, left: 50 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis
                        dataKey="components"
                        label={{ value: 'Components', position: 'bottom', offset: 20, style: { fill: 'hsl(var(--muted-foreground))' } }}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      />
                      <YAxis
                        domain={[0.4, 1]}
                        label={{ value: 'R²', angle: -90, position: 'left', offset: 35, style: { fill: 'hsl(var(--muted-foreground))' } }}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
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
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Line
                        type="monotone"
                        dataKey="r2_train"
                        stroke="hsl(var(--chart-1))"
                        strokeWidth={2}
                        name="Training"
                        dot={{ r: 3, fill: 'hsl(var(--chart-1))' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="r2_cv"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        name="Cross-validation"
                        dot={{ r: 3, fill: 'hsl(var(--primary))' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-6 mt-4 text-xs text-muted-foreground">
                  <span>Model: {prediction.model_name}</span>
                  <span>Task: {prediction.task_type || "regression"}</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

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
                      {prediction.val_score?.toFixed(4) ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">Validation Score</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-foreground">
                      {prediction.test_score?.toFixed(4) ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">Test Score</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-foreground">
                      {prediction.train_score?.toFixed(4) ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">Train Score</div>
                  </div>
                </div>
                {prediction.n_samples && (
                  <div className="flex justify-center gap-6 mt-4 text-xs text-muted-foreground">
                    <span>Samples: {prediction.n_samples}</span>
                    {prediction.n_features && <span>Features: {prediction.n_features}</span>}
                    {prediction.fold_id && <span>Fold: {prediction.fold_id}</span>}
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
