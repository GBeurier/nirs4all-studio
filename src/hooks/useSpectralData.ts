import { useState, useCallback } from 'react';
import { SpectralData } from '@/types/spectral';

export function useSpectralData() {
  const [rawData, setRawData] = useState<SpectralData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseCSV = useCallback((content: string): SpectralData => {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());

    // Find wavelength columns (numeric headers) and Y column
    const wavelengthIndices: number[] = [];
    const wavelengths: number[] = [];
    let yIndex = -1;

    headers.forEach((header, idx) => {
      const num = parseFloat(header);
      if (!isNaN(num) && num > 100) { // Assume wavelengths > 100nm
        wavelengthIndices.push(idx);
        wavelengths.push(num);
      } else if (header.toLowerCase() === 'y' || header.toLowerCase() === 'target' || header.toLowerCase() === 'reference') {
        yIndex = idx;
      }
    });

    // If no Y column found, check last column
    if (yIndex === -1) {
      if (!wavelengthIndices.includes(headers.length - 1)) {
        yIndex = headers.length - 1;
      }
    }

    const spectra: number[][] = [];
    const y: number[] = [];
    const sampleIds: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      if (values.length < wavelengthIndices.length) continue;

      const spectrum = wavelengthIndices.map(idx => parseFloat(values[idx]) || 0);
      spectra.push(spectrum);

      if (yIndex >= 0 && values[yIndex]) {
        y.push(parseFloat(values[yIndex]) || 0);
      } else {
        y.push(i); // Use row index as placeholder
      }

      // First column as sample ID if not a wavelength
      if (!wavelengthIndices.includes(0)) {
        sampleIds.push(values[0]);
      } else {
        sampleIds.push(`Sample ${i}`);
      }
    }

    return { wavelengths, spectra, y, sampleIds };
  }, []);

  const loadFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);

    try {
      const extension = file.name.split('.').pop()?.toLowerCase();

      if (extension === 'csv') {
        const content = await file.text();
        const data = parseCSV(content);
        setRawData(data);
      } else {
        throw new Error('Unsupported file format. Please use CSV files.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
      setRawData(null);
    } finally {
      setIsLoading(false);
    }
  }, [parseCSV]);

  const loadDemoData = useCallback(() => {
    // Generate synthetic NIR spectra
    const numSamples = 100;
    const numWavelengths = 200;
    const startWavelength = 1100;
    const endWavelength = 2500;

    const wavelengths = Array.from(
      { length: numWavelengths },
      (_, i) => startWavelength + (i * (endWavelength - startWavelength)) / (numWavelengths - 1)
    );

    const spectra: number[][] = [];
    const y: number[] = [];
    const sampleIds: string[] = [];

    for (let i = 0; i < numSamples; i++) {
      const concentration = Math.random() * 100;
      y.push(concentration);
      sampleIds.push(`Sample_${i + 1}`);

      // Generate spectrum with peaks related to concentration
      const spectrum = wavelengths.map((w) => {
        const baseline = 0.5 + 0.3 * Math.sin(w / 500);
        const noise = (Math.random() - 0.5) * 0.02;
        const scatter = 0.1 * Math.pow((w - 1800) / 1000, 2);

        // Absorption peaks
        const peak1 = 0.3 * concentration / 100 * Math.exp(-Math.pow((w - 1450) / 50, 2));
        const peak2 = 0.2 * concentration / 100 * Math.exp(-Math.pow((w - 1940) / 80, 2));
        const peak3 = 0.15 * (1 - concentration / 100) * Math.exp(-Math.pow((w - 2100) / 60, 2));

        return baseline + scatter + peak1 + peak2 + peak3 + noise;
      });

      spectra.push(spectrum);
    }

    setRawData({ wavelengths, spectra, y, sampleIds });
    setError(null);
  }, []);

  const clearData = useCallback(() => {
    setRawData(null);
    setError(null);
  }, []);

  return {
    rawData,
    isLoading,
    error,
    loadFile,
    loadDemoData,
    clearData,
  };
}
