export interface CombinedReportStatistics {
  sampleCount?: number;
  wavelengthCount?: number;
  selectedCount?: number;
  outlierCount?: number;
  yRange?: { min: number; max: number };
}

export interface CombinedReportGridInput {
  chartCount: number;
  width: number;
  height: number;
  padding: number;
  headerHeight: number;
  footerHeight: number;
}

export interface CombinedReportGrid {
  chartAreaTop: number;
  chartAreaHeight: number;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
}

export function buildCombinedReportGrid({
  chartCount,
  width,
  height,
  padding,
  headerHeight,
  footerHeight,
}: CombinedReportGridInput): CombinedReportGrid {
  const chartAreaTop = headerHeight + padding;
  const chartAreaHeight = height - headerHeight - footerHeight - padding * 2;

  let cols = 2;
  let rows = 2;
  if (chartCount === 1) {
    cols = 1;
    rows = 1;
  } else if (chartCount === 2) {
    cols = 2;
    rows = 1;
  } else if (chartCount === 3 || chartCount === 4) {
    cols = 2;
    rows = 2;
  } else {
    cols = 2;
    rows = Math.ceil(chartCount / 2);
  }

  const cellWidth = (width - padding * (cols + 1)) / cols;
  const cellHeight = Math.min(chartAreaHeight / rows - padding, cellWidth * 0.6);

  return {
    chartAreaTop,
    chartAreaHeight,
    cols,
    rows,
    cellWidth,
    cellHeight,
  };
}

export function formatCombinedReportChartLabel(chartType: string): string {
  return chartType.charAt(0).toUpperCase() + chartType.slice(1);
}

export interface CombinedReportChartPlacementInput {
  chartCount: number;
  cols: number;
  cellWidth: number;
  cellHeight: number;
  chartAreaTop: number;
  padding: number;
}

export interface CombinedReportChartPlacement {
  index: number;
  col: number;
  row: number;
  x: number;
  y: number;
}

/**
 * Compute the grid position of each chart cell in a combined report.
 * Pure counterpart to the draw loop in exportCombinedReport.
 */
export function buildCombinedReportChartPlacements({
  chartCount,
  cols,
  cellWidth,
  cellHeight,
  chartAreaTop,
  padding,
}: CombinedReportChartPlacementInput): CombinedReportChartPlacement[] {
  const placements: CombinedReportChartPlacement[] = [];
  for (let index = 0; index < chartCount; index++) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    placements.push({
      index,
      col,
      row,
      x: padding + col * (cellWidth + padding),
      y: chartAreaTop + row * (cellHeight + padding),
    });
  }
  return placements;
}

/** Format the header date string shown on a combined report. */
export function formatCombinedReportDate(now = new Date()): string {
  return now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildCombinedReportStatsParts(
  statistics?: CombinedReportStatistics,
): string[] {
  if (!statistics) {
    return [];
  }

  const statsParts: string[] = [];
  if (statistics.sampleCount !== undefined) {
    statsParts.push(`N = ${statistics.sampleCount}`);
  }
  if (statistics.wavelengthCount !== undefined) {
    statsParts.push(`Features = ${statistics.wavelengthCount}`);
  }
  if (statistics.selectedCount !== undefined && statistics.selectedCount > 0) {
    statsParts.push(`Selected = ${statistics.selectedCount}`);
  }
  if (statistics.outlierCount !== undefined && statistics.outlierCount > 0) {
    statsParts.push(`Outliers = ${statistics.outlierCount}`);
  }
  if (statistics.yRange) {
    statsParts.push(`Y range: ${statistics.yRange.min.toFixed(2)} - ${statistics.yRange.max.toFixed(2)}`);
  }

  return statsParts;
}
