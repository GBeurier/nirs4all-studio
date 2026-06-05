/**
 * Export System - Shared types for Playground export/serialization
 */

import type { FoldsInfo } from '@/types/playground';

// ============= Types =============

export type ExportFormat = 'png' | 'svg' | 'csv' | 'txt' | 'json';

export interface ExportOptions {
  /** Filename (without extension) */
  filename?: string;
  /** Include timestamp in filename */
  includeTimestamp?: boolean;
  /** Image quality (for PNG) 0-1 */
  quality?: number;
  /** Image scale factor (for PNG) */
  scale?: number;
  /** Include metadata in export */
  includeMetadata?: boolean;
}

export interface ChartExportData {
  /** Chart type identifier */
  chartType: 'spectra' | 'histogram' | 'pca' | 'folds' | 'repetitions';
  /** Chart container element or canvas */
  element?: HTMLElement | null;
  /** SVG element (if available) */
  svgElement?: SVGElement | null;
  /** Canvas element (if available) */
  canvasElement?: HTMLCanvasElement | null;
}

export interface DataExportContent {
  /** Spectra matrix (samples × wavelengths) */
  spectra?: number[][];
  /** Wavelength values */
  wavelengths?: number[];
  /** Target values */
  y?: number[];
  /** Sample IDs */
  sampleIds?: string[];
  /** Metadata columns */
  metadata?: Record<string, unknown[]>;
  /** PCA coordinates */
  pca?: number[][];
  /** Explained variance */
  explainedVariance?: number[];
  /** Folds information */
  folds?: FoldsInfo;
  /** Outlier indices (Phase 8) */
  outlierIndices?: Set<number> | number[];
}

export interface ExportResult {
  success: boolean;
  filename?: string;
  error?: string;
  format: ExportFormat;
  size?: number;
}
