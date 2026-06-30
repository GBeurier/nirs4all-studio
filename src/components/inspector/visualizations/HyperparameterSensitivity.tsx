/**
 * HyperparameterSensitivity — Scatter plot of hyperparameter value vs score.
 *
 * Adds explicit unsupported/empty states, optional log scaling, a fitted trend
 * line, and click-to-select affordances so the plot can be used as a real
 * exploration tool instead of a decorative scatter.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/useInspectorSelection';
import {
  buildHyperparameterColorMap,
  buildHyperparameterModelCounts,
  buildHyperparameterScaleData,
  buildHyperparameterTickValues,
  filterFiniteHyperparameterPoints,
  type HyperparameterScaleMode,
} from '@/lib/inspector/hyperparameterSensitivityData';
import { getHyperparameterEmptyDescription } from '@/lib/inspector/hyperparameterSensitivityPresentation';
import type { HyperparameterResponse } from '@/types/inspector';
import { HyperparameterAvailableParams } from './HyperparameterAvailableParams';
import { HyperparameterSensitivityHeader } from './HyperparameterSensitivityHeader';
import { HyperparameterSensitivityPlot, type HyperparameterHoveredPoint } from './HyperparameterSensitivityPlot';
import { HyperparameterStateCard } from './HyperparameterStateCard';
import { HyperparameterTrendSummary } from './HyperparameterTrendSummary';
import { useInspectorChartViewport } from './useInspectorChartViewport';

interface HyperparameterSensitivityProps {
  data: HyperparameterResponse | null | undefined;
  isLoading: boolean;
}

export function HyperparameterSensitivity({ data, isLoading }: HyperparameterSensitivityProps) {
  const { viewportRef, dimensions } = useInspectorChartViewport({
    initialWidth: 500,
    initialHeight: 350,
  });
  const [hovered, setHovered] = useState<HyperparameterHoveredPoint | null>(null);
  const [scaleMode, setScaleMode] = useState<HyperparameterScaleMode>('linear');
  const { select, selectedChains, hasSelection } = useInspectorSelection();

  const chartData = data;
  const reason = chartData?.reason?.trim() || null;

  const colorMap = useMemo(() => {
    return buildHyperparameterColorMap(chartData?.points);
  }, [chartData?.points]);

  const modelCounts = useMemo(() => {
    return buildHyperparameterModelCounts(chartData?.points);
  }, [chartData?.points]);

  const points = useMemo(() => {
    return filterFiniteHyperparameterPoints(chartData?.points);
  }, [chartData?.points]);

  const { xValues, yValues, useLogX, logAllowed, xDomain, yDomain, trend } = useMemo(() => {
    return buildHyperparameterScaleData(points, scaleMode);
  }, [points, scaleMode]);

  const marginLeft = 70;
  const marginRight = 20;
  const marginTop = 20;
  const marginBottom = 52;
  const plotW = Math.max(0, dimensions.width - marginLeft - marginRight);
  const plotH = Math.max(0, dimensions.height - marginTop - marginBottom);

  const scaleX = (value: number) => marginLeft + ((value - xDomain[0]) / Math.max(1e-12, xDomain[1] - xDomain[0])) * plotW;
  const scaleY = (value: number) => marginTop + plotH - ((value - yDomain[0]) / Math.max(1e-12, yDomain[1] - yDomain[0])) * plotH;

  const xTickValues = useMemo(() => {
    return buildHyperparameterTickValues(xDomain);
  }, [xDomain]);

  const yTickValues = useMemo(() => {
    return buildHyperparameterTickValues(yDomain);
  }, [yDomain]);

  const chartTitle = chartData?.param_name ?? 'Parameter';
  const scoreLabel = chartData?.score_column ?? 'Score';

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">Loading hyperparameter data...</span>
      </div>
    );
  }

  if (!chartData || points.length === 0) {
    return (
      <HyperparameterStateCard
        icon={AlertCircle}
        title="No hyperparameter signal"
        description={getHyperparameterEmptyDescription(reason)}
      />
    );
  }

  return (
    <div ref={viewportRef} className="flex h-full min-h-0 flex-col gap-3">
      <HyperparameterSensitivityHeader
        chartTitle={chartTitle}
        pointCount={points.length}
        modelFamilyCount={modelCounts.size}
        scoreLabel={scoreLabel}
        useLogX={useLogX}
        logAllowed={logAllowed}
        scaleMode={scaleMode}
        onScaleModeChange={setScaleMode}
      />

      {reason && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          {reason}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-lg border border-border/60 bg-card/40 p-2">
        <HyperparameterAvailableParams params={chartData.available_params} />

        <HyperparameterSensitivityPlot
          width={Math.max(dimensions.width, 420)}
          height={Math.max(dimensions.height, 280)}
          chartTitle={chartTitle}
          scoreLabel={scoreLabel}
          useLogX={useLogX}
          marginLeft={marginLeft}
          marginTop={marginTop}
          plotW={plotW}
          plotH={plotH}
          xDomain={xDomain}
          xTickValues={xTickValues}
          yTickValues={yTickValues}
          xValues={xValues}
          yValues={yValues}
          trend={trend}
          points={points}
          colorMap={colorMap}
          hovered={hovered}
          setHovered={setHovered}
          hasSelection={hasSelection}
          selectedChains={selectedChains}
          select={select}
          scaleX={scaleX}
          scaleY={scaleY}
        />
      </div>

      {trend && (
        <HyperparameterTrendSummary
          trend={trend}
          hasSelection={hasSelection}
          selectedCount={selectedChains.size}
        />
      )}
    </div>
  );
}
