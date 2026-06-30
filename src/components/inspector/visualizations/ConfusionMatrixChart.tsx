/**
 * ConfusionMatrixChart — Heatmap of confusion matrix for classification tasks.
 *
 * Renders a compact SVG matrix with row/column totals, readable labels,
 * and explicit unsupported/empty states. The chart is intentionally
 * defensive because confusion data is only meaningful for classification
 * chains with discrete labels.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import {
  buildConfusionMatrixHeaderSegments,
  buildConfusionMatrixLayout,
  buildConfusionMatrixSummary,
  getConfusionMatrixReason,
} from '@/lib/inspector/confusionMatrixData';
import {
  getConfusionMatrixEmptyDescription,
  getConfusionMatrixNoLabelsDescription,
} from '@/lib/inspector/confusionMatrixPresentation';
import type { ConfusionMatrixResponse } from '@/types/inspector';
import type { ConfusionMatrixData } from '@/lib/inspector/confusionMatrixData';
import { ConfusionMatrixHeader } from './ConfusionMatrixHeader';
import { ConfusionMatrixStateCard } from './ConfusionMatrixStateCard';
import { ConfusionMatrixSvg } from './ConfusionMatrixSvg';
import { ConfusionMatrixTooltip, type ConfusionMatrixHoveredCell } from './ConfusionMatrixTooltip';
import { useInspectorChartViewport } from './useInspectorChartViewport';

interface ConfusionMatrixChartProps {
  data: ConfusionMatrixResponse | null | undefined;
  isLoading: boolean;
}

export function ConfusionMatrixChart({ data, isLoading }: ConfusionMatrixChartProps) {
  const { viewportRef, dimensions } = useInspectorChartViewport({
    initialWidth: 500,
    initialHeight: 400,
  });
  const [hovered, setHovered] = useState<ConfusionMatrixHoveredCell | null>(null);
  const matrixData = data as ConfusionMatrixData | null | undefined;

  const summary = useMemo(() => buildConfusionMatrixSummary(matrixData), [matrixData]);
  const { rowTotals, colTotals, totalSamples, accuracy } = summary;
  const reason = getConfusionMatrixReason(matrixData);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">Loading confusion matrix...</span>
      </div>
    );
  }

  if (!matrixData || matrixData.cells.length === 0) {
    return (
      <ConfusionMatrixStateCard
        icon={AlertCircle}
        title={reason ? 'No confusion matrix available' : 'No confusion data'}
        description={getConfusionMatrixEmptyDescription(reason)}
      />
    );
  }

  const { labels } = matrixData;
  if (labels.length === 0) {
    return (
      <ConfusionMatrixStateCard
        icon={AlertCircle}
        title="No class labels found"
        description={getConfusionMatrixNoLabelsDescription(reason)}
      />
    );
  }

  const layout = buildConfusionMatrixLayout({
    width: dimensions.width,
    height: dimensions.height,
    labelCount: labels.length,
  });
  const headerSegments = buildConfusionMatrixHeaderSegments({
    data: matrixData,
    labelCount: labels.length,
    totalSamples,
    accuracy,
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <ConfusionMatrixHeader segments={headerSegments} />

      {reason && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          {reason}
        </div>
      )}

      <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60 bg-card/40">
        <ConfusionMatrixSvg
          labels={labels}
          layout={layout}
          summary={summary}
          hovered={hovered}
          setHovered={setHovered}
        />
      </div>

      <ConfusionMatrixTooltip hovered={hovered} totalSamples={totalSamples} />
    </div>
  );
}
