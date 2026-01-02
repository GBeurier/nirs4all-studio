import { OperatorType, OperatorParams, OperatorDefinition } from '@/types/spectral';

// Operator definitions with metadata
export const operatorDefinitions: OperatorDefinition[] = [
  {
    type: 'snv',
    name: 'SNV',
    description: 'Standard Normal Variate',
    icon: 'Waves',
    defaultParams: {},
    category: 'scatter',
    allowedTargets: ['X'],
  },
  {
    type: 'msc',
    name: 'MSC',
    description: 'Multiplicative Scatter Correction',
    icon: 'Scaling',
    defaultParams: { referenceType: 'mean' },
    category: 'scatter',
    allowedTargets: ['X'],
  },
  {
    type: 'savgol',
    name: 'Savitzky-Golay',
    description: 'Smoothing with polynomial fitting',
    icon: 'TrendingUp',
    defaultParams: { windowSize: 11, polyOrder: 2 },
    category: 'derivative',
    allowedTargets: ['X', 'Y'],
  },
  {
    type: 'derivative1',
    name: '1st Derivative',
    description: 'First derivative',
    icon: 'ArrowUpRight',
    defaultParams: { windowSize: 11, polyOrder: 2 },
    category: 'derivative',
    allowedTargets: ['X'],
  },
  {
    type: 'derivative2',
    name: '2nd Derivative',
    description: 'Second derivative',
    icon: 'ArrowUpRight',
    defaultParams: { windowSize: 11, polyOrder: 3 },
    category: 'derivative',
    allowedTargets: ['X'],
  },
  {
    type: 'smoothing',
    name: 'Smoothing',
    description: 'Moving average smoothing',
    icon: 'Spline',
    defaultParams: { windowSize: 5, method: 'movingAverage' },
    category: 'derivative',
    allowedTargets: ['X', 'Y'],
  },
  {
    type: 'meanCenter',
    name: 'Mean Center',
    description: 'Subtract mean',
    icon: 'AlignCenter',
    defaultParams: {},
    category: 'normalization',
    allowedTargets: ['X', 'Y'],
  },
  {
    type: 'normalize',
    name: 'Normalize',
    description: 'Scale to unit range/norm',
    icon: 'Maximize2',
    defaultParams: { method: 'vector' },
    category: 'normalization',
    allowedTargets: ['X', 'Y'],
  },
  {
    type: 'baseline',
    name: 'Baseline',
    description: 'Remove baseline drift',
    icon: 'Minus',
    defaultParams: { method: 'linear' },
    category: 'baseline',
    allowedTargets: ['X'],
  },
  {
    type: 'detrend',
    name: 'Detrend',
    description: 'Remove polynomial trend',
    icon: 'TrendingDown',
    defaultParams: { order: 1 },
    category: 'baseline',
    allowedTargets: ['X', 'Y'],
  },
  {
    type: 'wavelengthSelect',
    name: 'Wavelength Selection',
    description: 'Select/exclude ranges',
    icon: 'Scissors',
    defaultParams: { ranges: [], exclude: false },
    category: 'selection',
    allowedTargets: ['X'],
  },
];

// Simple moving average coefficients
function getMovingAverageCoeffs(windowSize: number): number[] {
  return new Array(windowSize).fill(1 / windowSize);
}

// Apply convolution
function convolve(signal: number[], kernel: number[]): number[] {
  const halfKernel = Math.floor(kernel.length / 2);
  const result: number[] = [];

  for (let i = 0; i < signal.length; i++) {
    let sum = 0;
    for (let j = 0; j < kernel.length; j++) {
      const idx = i - halfKernel + j;
      // Mirror padding at boundaries
      const mirrorIdx = idx < 0 ? -idx : idx >= signal.length ? 2 * signal.length - idx - 2 : idx;
      sum += signal[Math.max(0, Math.min(signal.length - 1, mirrorIdx))] * kernel[j];
    }
    result.push(sum);
  }

  return result;
}

// SNV transformation
export function applySNV(spectra: number[][]): number[][] {
  return spectra.map(spectrum => {
    const mean = spectrum.reduce((a, b) => a + b, 0) / spectrum.length;
    const std = Math.sqrt(spectrum.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / spectrum.length);
    return std === 0 ? spectrum : spectrum.map(v => (v - mean) / std);
  });
}

// MSC transformation
export function applyMSC(spectra: number[][], referenceType: 'mean' | 'median' = 'mean'): number[][] {
  const numWavelengths = spectra[0].length;
  const reference: number[] = [];

  for (let j = 0; j < numWavelengths; j++) {
    const values = spectra.map(s => s[j]);
    if (referenceType === 'mean') {
      reference.push(values.reduce((a, b) => a + b, 0) / values.length);
    } else {
      const sorted = [...values].sort((a, b) => a - b);
      reference.push(sorted[Math.floor(sorted.length / 2)]);
    }
  }

  return spectra.map(spectrum => {
    const n = spectrum.length;
    const sumX = reference.reduce((a, b) => a + b, 0);
    const sumY = spectrum.reduce((a, b) => a + b, 0);
    const sumXY = reference.reduce((acc, x, i) => acc + x * spectrum[i], 0);
    const sumX2 = reference.reduce((acc, x) => acc + x * x, 0);

    const a = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const b = (sumY - a * sumX) / n;

    return a === 0 ? spectrum : spectrum.map((v) => (v - b) / a);
  });
}

// First derivative
export function applyDerivative1(spectra: number[][], windowSize: number = 11): number[][] {
  return spectra.map(spectrum => {
    const result: number[] = [];
    for (let i = 0; i < spectrum.length; i++) {
      if (i === 0) {
        result.push(spectrum[1] - spectrum[0]);
      } else if (i === spectrum.length - 1) {
        result.push(spectrum[i] - spectrum[i - 1]);
      } else {
        result.push((spectrum[i + 1] - spectrum[i - 1]) / 2);
      }
    }
    const ws = windowSize % 2 === 0 ? windowSize + 1 : windowSize;
    return convolve(result, getMovingAverageCoeffs(ws));
  });
}

// Second derivative
export function applyDerivative2(spectra: number[][], windowSize: number = 11): number[][] {
  return spectra.map(spectrum => {
    const result: number[] = [];
    for (let i = 0; i < spectrum.length; i++) {
      if (i === 0 || i === spectrum.length - 1) {
        result.push(0);
      } else {
        result.push(spectrum[i + 1] - 2 * spectrum[i] + spectrum[i - 1]);
      }
    }
    const ws = windowSize % 2 === 0 ? windowSize + 1 : windowSize;
    return convolve(result, getMovingAverageCoeffs(ws));
  });
}

// Moving average smoothing
export function applySmoothing(spectra: number[][], windowSize: number): number[][] {
  const ws = windowSize % 2 === 0 ? windowSize + 1 : windowSize;
  const coeffs = getMovingAverageCoeffs(ws);
  return spectra.map(spectrum => convolve(spectrum, coeffs));
}

// Mean centering
export function applyMeanCenter(spectra: number[][]): number[][] {
  const numWavelengths = spectra[0].length;
  const means: number[] = [];

  for (let j = 0; j < numWavelengths; j++) {
    means.push(spectra.reduce((acc, s) => acc + s[j], 0) / spectra.length);
  }

  return spectra.map(spectrum => spectrum.map((v, j) => v - means[j]));
}

// Normalization
export function applyNormalize(spectra: number[][], method: 'minmax' | 'area' | 'vector' | 'max'): number[][] {
  return spectra.map(spectrum => {
    switch (method) {
      case 'minmax': {
        const min = Math.min(...spectrum);
        const max = Math.max(...spectrum);
        const range = max - min;
        return range === 0 ? spectrum : spectrum.map(v => (v - min) / range);
      }
      case 'area': {
        const area = spectrum.reduce((a, b) => a + Math.abs(b), 0);
        return area === 0 ? spectrum : spectrum.map(v => v / area);
      }
      case 'vector': {
        const norm = Math.sqrt(spectrum.reduce((a, b) => a + b * b, 0));
        return norm === 0 ? spectrum : spectrum.map(v => v / norm);
      }
      case 'max': {
        const max = Math.max(...spectrum.map(Math.abs));
        return max === 0 ? spectrum : spectrum.map(v => v / max);
      }
    }
  });
}

// Linear baseline correction
export function applyBaseline(spectra: number[][], method: 'linear' | 'polynomial' | 'als', polyOrder: number = 2): number[][] {
  if (method === 'linear') {
    return spectra.map(spectrum => {
      const n = spectrum.length;
      const slope = (spectrum[n - 1] - spectrum[0]) / (n - 1);
      return spectrum.map((v, i) => v - (spectrum[0] + slope * i));
    });
  } else if (method === 'polynomial') {
    return spectra.map(spectrum => {
      const n = spectrum.length;
      const baseline: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const val = spectrum[0] * (1 - t) + spectrum[n - 1] * t;
        baseline.push(val);
      }
      return spectrum.map((v, i) => v - baseline[i]);
    });
  }

  // ALS baseline (simplified - fallback to linear)
  return applyBaseline(spectra, 'linear');
}

// Detrending
export function applyDetrend(spectra: number[][], order: number = 1): number[][] {
  return spectra.map(spectrum => {
    const n = spectrum.length;
    const x = Array.from({ length: n }, (_, i) => i / (n - 1));

    if (order === 1) {
      const sumX = x.reduce((a, b) => a + b, 0);
      const sumY = spectrum.reduce((a, b) => a + b, 0);
      const sumXY = x.reduce((acc, xi, i) => acc + xi * spectrum[i], 0);
      const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);

      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      return spectrum.map((v, i) => v - (intercept + slope * x[i]));
    }

    return applyDetrend([spectrum], 1)[0];
  });
}

// Wavelength selection
export function applyWavelengthSelect(
  spectra: number[][],
  wavelengths: number[],
  ranges: [number, number][],
  exclude: boolean
): { spectra: number[][]; wavelengths: number[] } {
  if (ranges.length === 0) {
    return { spectra, wavelengths };
  }

  const mask = wavelengths.map(w => {
    const inRange = ranges.some(([min, max]) => w >= min && w <= max);
    return exclude ? !inRange : inRange;
  });

  const newWavelengths = wavelengths.filter((_, i) => mask[i]);
  const newSpectra = spectra.map(s => s.filter((_, i) => mask[i]));

  return { spectra: newSpectra, wavelengths: newWavelengths };
}

// Main processing function
export function processSpectrum(
  spectra: number[][],
  wavelengths: number[],
  operatorType: OperatorType,
  params: OperatorParams[OperatorType]
): { spectra: number[][]; wavelengths: number[] } {
  let result = spectra;
  let newWavelengths = wavelengths;

  switch (operatorType) {
    case 'snv':
      result = applySNV(spectra);
      break;
    case 'msc':
      result = applyMSC(spectra, (params as OperatorParams['msc']).referenceType);
      break;
    case 'savgol': {
      const p = params as OperatorParams['savgol'];
      result = applySmoothing(spectra, p.windowSize);
      break;
    }
    case 'derivative1': {
      const p = params as OperatorParams['derivative1'];
      result = applyDerivative1(spectra, p.windowSize);
      break;
    }
    case 'derivative2': {
      const p = params as OperatorParams['derivative2'];
      result = applyDerivative2(spectra, p.windowSize);
      break;
    }
    case 'smoothing': {
      const p = params as OperatorParams['smoothing'];
      result = applySmoothing(spectra, p.windowSize);
      break;
    }
    case 'meanCenter':
      result = applyMeanCenter(spectra);
      break;
    case 'normalize': {
      const p = params as OperatorParams['normalize'];
      result = applyNormalize(spectra, p.method);
      break;
    }
    case 'baseline': {
      const p = params as OperatorParams['baseline'];
      result = applyBaseline(spectra, p.method, p.polyOrder);
      break;
    }
    case 'detrend': {
      const p = params as OperatorParams['detrend'];
      result = applyDetrend(spectra, p.order);
      break;
    }
    case 'wavelengthSelect': {
      const p = params as OperatorParams['wavelengthSelect'];
      const wsResult = applyWavelengthSelect(spectra, wavelengths, p.ranges, p.exclude);
      result = wsResult.spectra;
      newWavelengths = wsResult.wavelengths;
      break;
    }
  }

  return { spectra: result, wavelengths: newWavelengths };
}
