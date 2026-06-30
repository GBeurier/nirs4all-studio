import type { ConfusionMatrixCell, ConfusionMatrixResponse } from '@/types/inspector';

export const CONFUSION_MATRIX_BLUES = [
  '#eff6ff',
  '#dbeafe',
  '#bfdbfe',
  '#93c5fd',
  '#60a5fa',
  '#3b82f6',
  '#2563eb',
  '#1d4ed8',
  '#1e40af',
  '#1e3a8a',
];

export type ConfusionMatrixData = ConfusionMatrixResponse & { reason?: string | null };

export interface ConfusionMatrixSummary {
  cellMap: Map<string, ConfusionMatrixCell>;
  maxValue: number;
  rowTotals: Map<string, number>;
  colTotals: Map<string, number>;
  totalSamples: number;
  accuracy: number;
  displayValues: boolean;
}

export interface ConfusionMatrixLayout {
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  svgW: number;
  svgH: number;
  plotW: number;
  plotH: number;
  cellW: number;
  cellH: number;
  cellLabelThreshold: boolean;
}

export interface ConfusionMatrixCellView {
  trueLabel: string;
  predLabel: string;
  count: number;
  normalized: number | null;
  value: number;
  color: string;
  textColor: string;
  isHovered: boolean;
  isDiagonal: boolean;
  isEmpty: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  stroke: string;
  strokeWidth: number;
  label: string | number;
  labelX: number;
  labelY: number;
  labelFontSize: number;
  showLabel: boolean;
}

export interface ConfusionMatrixHoveredCellRef {
  true_label: string;
  pred_label: string;
}

export function getConfusionMatrixCellKey(trueLabel: string, predLabel: string): string {
  return `${trueLabel}|${predLabel}`;
}

export function getConfusionMatrixReason(
  data: ConfusionMatrixData | null | undefined,
): string | null {
  return data?.reason?.trim() || null;
}

export function buildConfusionMatrixSummary(
  data: ConfusionMatrixData | null | undefined,
): ConfusionMatrixSummary {
  if (!data?.cells) {
    return {
      cellMap: new Map<string, ConfusionMatrixCell>(),
      maxValue: 0,
      rowTotals: new Map<string, number>(),
      colTotals: new Map<string, number>(),
      totalSamples: 0,
      accuracy: 0,
      displayValues: false,
    };
  }

  const cellMap = new Map<string, ConfusionMatrixCell>();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  let maxValue = 0;
  let diagonal = 0;

  for (const cell of data.cells) {
    cellMap.set(getConfusionMatrixCellKey(cell.true_label, cell.pred_label), cell);
    rowTotals.set(cell.true_label, (rowTotals.get(cell.true_label) ?? 0) + cell.count);
    colTotals.set(cell.pred_label, (colTotals.get(cell.pred_label) ?? 0) + cell.count);
    if (cell.count > maxValue) maxValue = cell.count;
    if (cell.true_label === cell.pred_label) diagonal += cell.count;
  }

  const totalSamples = data.total_samples || Array.from(rowTotals.values()).reduce((sum, value) => sum + value, 0);
  return {
    cellMap,
    maxValue,
    rowTotals,
    colTotals,
    totalSamples,
    accuracy: totalSamples > 0 ? diagonal / totalSamples : 0,
    displayValues: data.normalize !== 'none',
  };
}

export function buildConfusionMatrixLayout({
  width,
  height,
  labelCount,
}: {
  width: number;
  height: number;
  labelCount: number;
}): ConfusionMatrixLayout {
  const marginLeft = 148;
  const marginRight = 20;
  const marginTop = 86;
  const marginBottom = 86;
  const svgW = Math.max(width, marginLeft + marginRight + labelCount * 46);
  const svgH = Math.max(height, marginTop + marginBottom + labelCount * 38);
  const plotW = svgW - marginLeft - marginRight;
  const plotH = svgH - marginTop - marginBottom;
  const cellW = labelCount > 0 ? plotW / labelCount : 0;
  const cellH = labelCount > 0 ? plotH / labelCount : 0;

  return {
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
    svgW,
    svgH,
    plotW,
    plotH,
    cellW,
    cellH,
    cellLabelThreshold: cellW > 38 && cellH > 28,
  };
}

export function getConfusionMatrixBlueColor(value: number, maxValue: number): string {
  if (maxValue <= 0 || value <= 0) return '#f8fafc';
  const ratio = Math.min(value / maxValue, 1);
  const index = Math.round(ratio * (CONFUSION_MATRIX_BLUES.length - 1));
  return CONFUSION_MATRIX_BLUES[index];
}

export function getConfusionMatrixTextColor(value: number, maxValue: number): string {
  if (maxValue <= 0) return '#0f172a';
  return value / maxValue > 0.55 ? '#ffffff' : '#0f172a';
}

export function formatConfusionMatrixLabel(label: string, maxLength = 12): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}

export function formatConfusionMatrixAccuracy(accuracy: number): string {
  return `${(accuracy * 100).toFixed(1)}%`;
}

export function formatConfusionMatrixNormalizeLabel(normalize: string): string {
  return normalize === 'none' ? 'raw counts' : `normalized: ${normalize}`;
}

export function formatConfusionMatrixNormalizedPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function buildConfusionMatrixHeaderSegments({
  data,
  labelCount,
  totalSamples,
  accuracy,
}: {
  data: Pick<ConfusionMatrixData, 'partition' | 'normalize'>;
  labelCount: number;
  totalSamples: number;
  accuracy: number;
}): string[] {
  return [
    data.partition,
    formatConfusionMatrixNormalizeLabel(data.normalize),
    `${labelCount} labels`,
    `${totalSamples} samples`,
    `diag accuracy ${formatConfusionMatrixAccuracy(accuracy)}`,
  ];
}

export function formatConfusionMatrixCellValue({
  displayValues,
  normalized,
  count,
}: {
  displayValues: boolean;
  normalized: number | null;
  count: number;
}): string | number {
  return displayValues && normalized != null
    ? formatConfusionMatrixNormalizedPercent(normalized)
    : count;
}

export function buildConfusionMatrixCellView({
  trueLabel,
  predLabel,
  rowIndex,
  colIndex,
  summary,
  layout,
  hovered,
}: {
  trueLabel: string;
  predLabel: string;
  rowIndex: number;
  colIndex: number;
  summary: ConfusionMatrixSummary;
  layout: ConfusionMatrixLayout;
  hovered: ConfusionMatrixHoveredCellRef | null;
}): ConfusionMatrixCellView {
  const cell = summary.cellMap.get(getConfusionMatrixCellKey(trueLabel, predLabel));
  const count = cell?.count ?? 0;
  const normalized = cell?.normalized ?? null;
  const value = summary.displayValues && normalized != null ? normalized : count;
  const isHovered = hovered?.true_label === trueLabel && hovered?.pred_label === predLabel;
  const isDiagonal = rowIndex === colIndex;
  const isEmpty = count === 0;

  return {
    trueLabel,
    predLabel,
    count,
    normalized,
    value,
    color: getConfusionMatrixBlueColor(value, summary.maxValue),
    textColor: getConfusionMatrixTextColor(value, summary.maxValue),
    isHovered,
    isDiagonal,
    isEmpty,
    x: colIndex * layout.cellW + 1,
    y: rowIndex * layout.cellH + 1,
    width: Math.max(0, layout.cellW - 2),
    height: Math.max(0, layout.cellH - 2),
    opacity: isHovered ? 1 : isEmpty ? 0.65 : 0.92,
    stroke: isHovered ? '#ffffff' : isDiagonal ? '#3b82f6' : '#e2e8f0',
    strokeWidth: isHovered ? 2 : isDiagonal ? 1 : 0.7,
    label: formatConfusionMatrixCellValue({
      displayValues: summary.displayValues,
      normalized,
      count,
    }),
    labelX: colIndex * layout.cellW + layout.cellW / 2,
    labelY: rowIndex * layout.cellH + layout.cellH / 2,
    labelFontSize: Math.min(12, layout.cellH * 0.34, layout.cellW * 0.28),
    showLabel: layout.cellLabelThreshold,
  };
}
