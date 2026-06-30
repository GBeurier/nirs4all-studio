import type { SampleMetadata, SpectralData } from '@/types/spectral';

export interface SyntheticSpectralDataOptions {
  numBioSamples?: number;
  numReps?: number;
  numTestBioSamples?: number;
  numWavelengths?: number;
  startWavelength?: number;
  endWavelength?: number;
  random?: () => number;
}

const DEFAULT_SYNTHETIC_SPECTRAL_DATA_OPTIONS = {
  numBioSamples: 175,
  numReps: 4,
  numTestBioSamples: 35,
  numWavelengths: 200,
  startWavelength: 1100,
  endWavelength: 2500,
} satisfies Required<Omit<SyntheticSpectralDataOptions, 'random'>>;

/**
 * Builds legacy spectral demo data with a stable repetition and partition contract.
 *
 * Samples are emitted train-first and test-last so downstream playground execution can
 * forward source partitions to the backend without recomputing the split.
 */
export function createSyntheticSpectralData(options: SyntheticSpectralDataOptions = {}): SpectralData {
  const {
    numBioSamples,
    numReps,
    numTestBioSamples,
    numWavelengths,
    startWavelength,
    endWavelength,
  } = {
    ...DEFAULT_SYNTHETIC_SPECTRAL_DATA_OPTIONS,
    ...options,
  };
  const random = options.random ?? Math.random;

  if (numBioSamples <= 0) {
    throw new Error('Synthetic spectral data requires at least one biological sample');
  }
  if (numReps <= 0) {
    throw new Error('Synthetic spectral data requires at least one repetition');
  }
  if (numTestBioSamples < 0 || numTestBioSamples > numBioSamples) {
    throw new Error('Synthetic spectral data test sample count must fit within the biological sample count');
  }
  if (numWavelengths < 2) {
    throw new Error('Synthetic spectral data requires at least two wavelengths');
  }

  const numTrainBioSamples = numBioSamples - numTestBioSamples;
  const wavelengths = Array.from(
    { length: numWavelengths },
    (_, i) => startWavelength + (i * (endWavelength - startWavelength)) / (numWavelengths - 1)
  );

  const spectra: number[][] = [];
  const y: number[] = [];
  const sampleIds: string[] = [];
  const metadata: SampleMetadata[] = [];

  for (let bioIdx = 0; bioIdx < numBioSamples; bioIdx++) {
    const trueConcentration = random() * 100;
    const bioId = String(bioIdx + 1).padStart(2, '0');
    const instrumentId = `instrument_${String((bioIdx % 5) + 1).padStart(2, '0')}`;
    const batchId = `batch_${String((bioIdx % 15) + 1).padStart(2, '0')}`;
    const lotId = `lot_${String((bioIdx % 100) + 1).padStart(3, '0')}`;

    for (let rep = 0; rep < numReps; rep++) {
      const measuredConcentration = trueConcentration + (random() - 0.5) * 5;
      y.push(Math.max(0, Math.min(100, measuredConcentration)));
      sampleIds.push(`Sample_${bioId}_r${rep + 1}`);

      metadata.push({
        bio_sample: `Sample_${bioId}`,
        repetition: rep + 1,
        instrument: instrumentId,
        batch: batchId,
        lot: lotId,
      });

      const repVariation = (random() - 0.5) * 0.01;
      const spectrum = wavelengths.map((w) => {
        const baseline = 0.5 + 0.3 * Math.sin(w / 500);
        const noise = (random() - 0.5) * 0.02;
        const scatter = 0.1 * Math.pow((w - 1800) / 1000, 2);
        const peak1 = 0.3 * trueConcentration / 100 * Math.exp(-Math.pow((w - 1450) / 50, 2));
        const peak2 = 0.2 * trueConcentration / 100 * Math.exp(-Math.pow((w - 1940) / 80, 2));
        const peak3 = 0.15 * (1 - trueConcentration / 100) * Math.exp(-Math.pow((w - 2100) / 60, 2));
        return baseline + scatter + peak1 + peak2 + peak3 + noise + repVariation;
      });
      spectra.push(spectrum);
    }
  }

  return {
    wavelengths,
    spectra,
    y,
    sampleIds,
    metadata,
    wavelengthUnit: 'nm',
    sourcePartitions: {
      has_test: true,
      n_train: numTrainBioSamples * numReps,
      n_test: numTestBioSamples * numReps,
    },
  };
}
