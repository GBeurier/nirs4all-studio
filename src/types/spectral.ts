/**
 * Types for spectral data
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
  datasetSource?: string[];
}

export interface ProcessedData extends SpectralData {
  originalSpectra: number[][];
  originalY: number[];
}

export type SubsetMode = 'all' | 'random' | 'quantiles' | 'kmeans';

export type ColorMode = 'target' | 'dataset' | 'metadata';

export interface ColorConfig {
  mode: ColorMode;
  metadataKey?: string;
}
