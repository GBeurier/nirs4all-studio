import type { InspectorGroup, ScatterResponse } from '@/types/inspector';

export interface PredVsObsDot {
  x: number;
  y: number;
  chainId: string;
  modelClass: string;
  color: string;
}

export interface PredVsObsDotsData {
  dots: PredVsObsDot[];
  minVal: number;
  maxVal: number;
}

export interface PredVsObsMetrics {
  r2: number | null;
  rmse: number | null;
}

export interface PredVsObsCanvasPoint {
  x: number;
  y: number;
  color: string;
  opacity: number;
  radius: number;
  chainId: string;
  meta?: Record<string, unknown>;
}

export interface PredVsObsCanvasReferenceLine {
  type: 'y-equals-x' | 'horizontal' | 'vertical';
  value?: number;
  color: string;
  dash?: number[];
  width?: number;
  label?: string;
}

export const PRED_VS_OBS_FALLBACK_COLOR = '#64748b';

export function buildPredVsObsChainColorMap(groups: readonly InspectorGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const chainId of group.chain_ids) {
      map.set(chainId, group.color);
    }
  }
  return map;
}

export function buildPredVsObsDots(
  data: ScatterResponse | null | undefined,
  chainColorMap: ReadonlyMap<string, string>,
): PredVsObsDotsData {
  if (!data?.points?.length) {
    return { dots: [], minVal: 0, maxVal: 1 };
  }

  const dots: PredVsObsDot[] = [];
  let min = Infinity;
  let max = -Infinity;

  for (const point of data.points) {
    const color = chainColorMap.get(point.chain_id) ?? PRED_VS_OBS_FALLBACK_COLOR;
    const length = Math.min(point.y_true.length, point.y_pred.length);
    for (let index = 0; index < length; index++) {
      const x = point.y_true[index];
      const y = point.y_pred[index];
      dots.push({ x, y, chainId: point.chain_id, modelClass: point.model_class, color });
      if (x < min) min = x;
      if (x > max) max = x;
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }

  if (dots.length === 0) {
    return { dots: [], minVal: 0, maxVal: 1 };
  }

  const range = max - min || 1;
  return {
    dots,
    minVal: min - range * 0.05,
    maxVal: max + range * 0.05,
  };
}

export function computePredVsObsMetrics(dots: readonly Pick<PredVsObsDot, 'x' | 'y'>[]): PredVsObsMetrics {
  if (dots.length === 0) return { r2: null, rmse: null };

  const n = dots.length;
  const meanY = dots.reduce((sum, dot) => sum + dot.x, 0) / n;
  let ssRes = 0;
  let ssTot = 0;

  for (const dot of dots) {
    const residual = dot.y - dot.x;
    ssRes += residual * residual;
    ssTot += (dot.x - meanY) * (dot.x - meanY);
  }

  return {
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    rmse: Math.sqrt(ssRes / n),
  };
}

export function createPredVsObsTickFormatter(minVal: number, maxVal: number): (value: number) => string {
  const range = maxVal - minVal;
  if (range === 0) return (value: number) => value.toFixed(2);
  const magnitude = Math.abs(Math.log10(range));
  const decimals = magnitude > 2 ? 1 : magnitude > 1 ? 2 : range < 0.1 ? 4 : 3;
  return (value: number) => value.toFixed(decimals);
}

export function buildPredVsObsCanvasPoints({
  dots,
  hasSelection,
  selectedChains,
  hoveredChain,
}: {
  dots: readonly PredVsObsDot[];
  hasSelection: boolean;
  selectedChains: ReadonlySet<string>;
  hoveredChain: string | null;
}): PredVsObsCanvasPoint[] {
  return dots.map((dot) => {
    const isSelected = hasSelection && selectedChains.has(dot.chainId);
    const isHovered = hoveredChain === dot.chainId;
    const dimmed = hasSelection && !isSelected;
    return {
      x: dot.x,
      y: dot.y,
      color: dot.color,
      opacity: dimmed ? 0.15 : isHovered ? 1 : 0.7,
      radius: isHovered ? 5 : isSelected ? 4 : 3,
      chainId: dot.chainId,
      meta: { modelClass: dot.modelClass },
    };
  });
}

export function buildPredVsObsCanvasReferenceLines(): PredVsObsCanvasReferenceLine[] {
  return [{
    type: 'y-equals-x',
    color: '#94a3b8',
    dash: [4, 4],
    width: 1,
  }];
}

export function getPredVsObsSelectionMode(event: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): 'add' | 'toggle' {
  if (event.shiftKey) return 'add';
  if (event.ctrlKey || event.metaKey) return 'toggle';
  return 'toggle';
}
