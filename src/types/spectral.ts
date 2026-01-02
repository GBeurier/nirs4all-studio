/**
 * Types for spectral data and preprocessing pipeline
 */

export interface SampleMetadata {
  [key: string]: string | number | boolean;
}

export interface SpectralData {
  wavelengths: number[];
  spectra: number[][];
  y: number[];
  sampleIds?: string[];
  metadata?: SampleMetadata[];
  datasetSource?: string[]; // Track which dataset each sample came from
}

export interface ProcessedData extends SpectralData {
  originalSpectra: number[][];
  originalY: number[];
}

export type OperatorTarget = 'X' | 'Y' | 'all';

export type OperatorType =
  | 'snv'
  | 'msc'
  | 'savgol'
  | 'derivative1'
  | 'derivative2'
  | 'smoothing'
  | 'meanCenter'
  | 'normalize'
  | 'baseline'
  | 'detrend'
  | 'wavelengthSelect';

export interface OperatorParams {
  snv: Record<string, never>;
  msc: { referenceType: 'mean' | 'median' };
  savgol: { windowSize: number; polyOrder: number };
  derivative1: { windowSize: number; polyOrder: number };
  derivative2: { windowSize: number; polyOrder: number };
  smoothing: { windowSize: number; method: 'movingAverage' | 'gaussian' };
  meanCenter: Record<string, never>;
  normalize: { method: 'minmax' | 'area' | 'vector' | 'max' };
  baseline: { method: 'linear' | 'polynomial' | 'als'; polyOrder?: number; lambda?: number; p?: number };
  detrend: { order: number };
  wavelengthSelect: { ranges: [number, number][]; exclude: boolean };
}

export interface PipelineOperator<T extends OperatorType = OperatorType> {
  id: string;
  type: T;
  params: OperatorParams[T];
  enabled: boolean;
  name: string;
  target: OperatorTarget;
}

export interface PipelineState {
  operators: PipelineOperator[];
  history: PipelineOperator[][];
  historyIndex: number;
}

export type SubsetMode = 'all' | 'random' | 'quantiles' | 'kmeans';

export type ColorMode = 'target' | 'dataset' | 'metadata';

export type DifferenceMetric = 'rmse' | 'mae' | 'maxDiff' | 'meanDiff' | 'correlation';

export interface ColorConfig {
  mode: ColorMode;
  metadataKey?: string;
}

export interface OperatorDefinition {
  type: OperatorType;
  name: string;
  description: string;
  icon: string;
  defaultParams: OperatorParams[OperatorType];
  category: 'scatter' | 'derivative' | 'normalization' | 'baseline' | 'selection';
  allowedTargets: OperatorTarget[];
}
