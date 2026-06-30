import type { ScatterResponse } from '@/types/inspector';

export interface ResidualDot {
  x: number;
  y: number;
  yTrue: number;
  chainId: string;
  modelClass: string;
}

export interface ResidualStats {
  meanResidual: number;
  stdResidual: number;
}

export interface ResidualDotsData extends ResidualStats {
  dots: ResidualDot[];
}

export interface ResidualCanvasPoint {
  x: number;
  y: number;
  color: string;
  opacity: number;
  radius: number;
  chainId: string;
  meta?: Record<string, unknown>;
}

export interface ResidualCanvasReferenceLine {
  type: 'y-equals-x' | 'horizontal' | 'vertical';
  value?: number;
  color: string;
  dash?: number[];
  width?: number;
  label?: string;
}

export interface ResidualPointStyle {
  color: string;
  opacity: number;
  radius: number;
  stroke: string;
  strokeWidth: number;
}

export function buildResidualDots(data: ScatterResponse | null | undefined): ResidualDotsData {
  if (!data?.points?.length) {
    return { dots: [], meanResidual: 0, stdResidual: 0 };
  }

  const dots: ResidualDot[] = [];
  for (const point of data.points) {
    const length = Math.min(point.y_true.length, point.y_pred.length);
    for (let index = 0; index < length; index++) {
      const yTrue = point.y_true[index];
      const yPred = point.y_pred[index];
      dots.push({
        x: yPred,
        y: yPred - yTrue,
        yTrue,
        chainId: point.chain_id,
        modelClass: point.model_class,
      });
    }
  }

  if (dots.length === 0) {
    return { dots, meanResidual: 0, stdResidual: 0 };
  }

  const residuals = dots.map((dot) => dot.y);
  const meanResidual = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
  const variance = residuals.reduce((sum, value) => sum + (value - meanResidual) ** 2, 0) / residuals.length;
  return {
    dots,
    meanResidual,
    stdResidual: Math.sqrt(variance),
  };
}

export function createResidualXTickFormatter(dots: readonly Pick<ResidualDot, 'x'>[]): (value: number) => string {
  if (dots.length === 0) return (value: number) => value.toFixed(2);
  const values = dots.map((dot) => dot.x);
  const range = Math.max(...values) - Math.min(...values);
  if (range === 0) return (value: number) => value.toFixed(2);
  const decimals = range < 0.01 ? 4 : range < 0.1 ? 3 : range < 10 ? 2 : 1;
  return (value: number) => value.toFixed(decimals);
}

export function createResidualYTickFormatter(stdResidual: number): (value: number) => string {
  if (stdResidual === 0) return (value: number) => value.toFixed(4);
  const range = stdResidual * 4;
  const decimals = range < 0.01 ? 4 : range < 0.1 ? 3 : range < 10 ? 2 : 1;
  return (value: number) => value.toFixed(decimals);
}

export function buildResidualCanvasPoints({
  dots,
  getChainColor,
  getChainOpacity,
  hoveredChain,
  hasSelection,
  selectedChains,
}: {
  dots: readonly ResidualDot[];
  getChainColor: (chainId: string) => string;
  getChainOpacity: (chainId: string) => number;
  hoveredChain: string | null;
  hasSelection: boolean;
  selectedChains: ReadonlySet<string>;
}): ResidualCanvasPoint[] {
  return dots.map((dot) => {
    const isHovered = hoveredChain === dot.chainId;
    const isSelected = hasSelection && selectedChains.has(dot.chainId);
    return {
      x: dot.x,
      y: dot.y,
      color: getChainColor(dot.chainId),
      opacity: isHovered ? 1 : getChainOpacity(dot.chainId),
      radius: isHovered ? 5 : isSelected ? 4 : 3,
      chainId: dot.chainId,
      meta: { modelClass: dot.modelClass, yTrue: dot.yTrue },
    };
  });
}

export function buildResidualReferenceLines(stdResidual: number): ResidualCanvasReferenceLine[] {
  const lines: ResidualCanvasReferenceLine[] = [
    { type: 'horizontal', value: 0, color: '#94a3b8', width: 1.5 },
  ];
  if (stdResidual > 0) {
    const band = stdResidual * 2;
    lines.push({ type: 'horizontal', value: band, color: '#f59e0b', dash: [4, 4], width: 1 });
    lines.push({ type: 'horizontal', value: -band, color: '#f59e0b', dash: [4, 4], width: 1 });
  }
  return lines;
}

export function getResidualSelectionMode(event: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): 'add' | 'toggle' {
  if (event.shiftKey) return 'add';
  if (event.ctrlKey || event.metaKey) return 'toggle';
  return 'toggle';
}

export function getResidualPointStyle({
  dot,
  getChainColor,
  getChainOpacity,
  hoveredChain,
  hasSelection,
  selectedChains,
}: {
  dot: Pick<ResidualDot, 'chainId'>;
  getChainColor: (chainId: string) => string;
  getChainOpacity: (chainId: string) => number;
  hoveredChain: string | null;
  hasSelection: boolean;
  selectedChains: ReadonlySet<string>;
}): ResidualPointStyle {
  const color = getChainColor(dot.chainId);
  const isHovered = hoveredChain === dot.chainId;
  const isSelected = hasSelection && selectedChains.has(dot.chainId);
  return {
    color,
    opacity: isHovered ? 1 : getChainOpacity(dot.chainId),
    radius: isHovered ? 5 : 3,
    stroke: isSelected ? color : 'none',
    strokeWidth: isSelected ? 1.5 : 0,
  };
}
