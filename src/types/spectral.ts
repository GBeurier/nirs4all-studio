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
  /**
   * Configured dataset repetition column, when the data came from a workspace
   * dataset that already defines how repeated measurements are grouped.
   */
  repetitionColumn?: string | null;
  /**
   * Unit of the wavelength axis (e.g. "nm", "cm-1"), as detected by nirs4all
   * from the dataset headers. Used by spectra charts to label the X axis with
   * the correct quantity ("Wavelength (nm)" vs "Wavenumber (cm⁻¹)") instead of
   * hardcoding "nm".
   */
  wavelengthUnit?: string;
  /**
   * Pre-existing train/test partitioning of the samples, when the data source
   * already knows the split (demo data, workspace datasets). Samples MUST be
   * ordered train-first / test-last so that indices [0, n_train) are train and
   * [n_train, n_train + n_test) are test. The backend forwards this to the
   * executor via options.source_partitions.
   */
  sourcePartitions?: {
    has_test: boolean;
    n_train: number;
    n_test: number;
  };
}

export interface ProcessedData extends SpectralData {
  originalSpectra: number[][];
  originalY: number[];
}

export type SubsetMode = 'all' | 'random' | 'quantiles' | 'kmeans';
