import type { BeeswarmBin } from '@/types/shap';

export interface ShapBeeswarmPoint {
  x: number;
  y: number;
  color: number;
  sampleIdx: number;
  binLabel: string;
}

export interface ShapBeeswarmTick {
  value: number;
  label: string;
}

export interface ShapBeeswarmPointStyle {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
}

export type ShapBeeswarmRandom = () => number;

export const SHAP_BEESWARM_SELECTED_COLOR = '#f59e0b';

export function getShapBeeswarmPointColor(featureValue: number): string {
  if (featureValue > 0.8) return '#ef4444';
  if (featureValue > 0.6) return '#f97316';
  if (featureValue > 0.4) return '#eab308';
  if (featureValue > 0.2) return '#22c55e';
  return '#3b82f6';
}

export function getShapBeeswarmPointStyle(
  featureValue: number,
  isSelected: boolean,
): ShapBeeswarmPointStyle {
  return {
    fill: isSelected ? SHAP_BEESWARM_SELECTED_COLOR : getShapBeeswarmPointColor(featureValue),
    fillOpacity: isSelected ? 1 : 0.7,
    stroke: isSelected ? SHAP_BEESWARM_SELECTED_COLOR : 'none',
    strokeWidth: isSelected ? 2 : 0,
  };
}

export function buildShapBeeswarmBinPoints(
  bin: BeeswarmBin,
  binIndex: number,
  random: ShapBeeswarmRandom = Math.random,
): ShapBeeswarmPoint[] {
  return bin.points.map((point) => {
    const jitter = (random() - 0.5) * 0.6;
    return {
      x: point.shap_value,
      y: binIndex + jitter,
      color: point.feature_value,
      sampleIdx: point.sample_idx,
      binLabel: bin.label,
    };
  });
}

export function buildShapBeeswarmPoints(
  bins: BeeswarmBin[],
  random: ShapBeeswarmRandom = Math.random,
): ShapBeeswarmPoint[] {
  return bins.flatMap((bin, binIndex) => buildShapBeeswarmBinPoints(bin, binIndex, random));
}

export function buildShapBeeswarmYTicks(bins: BeeswarmBin[]): ShapBeeswarmTick[] {
  return bins.map((bin, index) => ({
    value: index,
    label: bin.label,
  }));
}
