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
   * Unit of the wavelength axis (e.g. "nm", "cm-1"), as detected by nirs4all
   * from the dataset headers. Used by spectra charts to label the X axis with
   * the correct quantity ("Wavelength (nm)" vs "Wavenumber (cm⁻¹)") instead of
   * hardcoding "nm".
   */
  wavelengthUnit?: string;
}

export interface ProcessedData extends SpectralData {
  originalSpectra: number[][];
  originalY: number[];
}

export type SubsetMode = 'all' | 'random' | 'quantiles' | 'kmeans';
