import type { PreviewData } from "../contexts";

export function getColorForTarget(
  target: number,
  targetType: "regression" | "classification",
  minTarget: number,
  maxTarget: number
): string {
  if (targetType === "classification") {
    const classColors = [
      "#3b82f6", // blue
      "#ef4444", // red
      "#22c55e", // green
      "#f59e0b", // amber
      "#8b5cf6", // violet
      "#ec4899", // pink
      "#06b6d4", // cyan
      "#f97316", // orange
    ];
    const classIndex = Math.floor(target) % classColors.length;
    return classColors[classIndex];
  }

  // Continuous color scale for regression (blue to red)
  const normalizedTarget =
    maxTarget !== minTarget
      ? (target - minTarget) / (maxTarget - minTarget)
      : 0.5;

  const r = Math.round(normalizedTarget * 239 + (1 - normalizedTarget) * 59);
  const g = Math.round(normalizedTarget * 68 + (1 - normalizedTarget) * 130);
  const b = Math.round(normalizedTarget * 68 + (1 - normalizedTarget) * 246);

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Compute the merged Recharts rows for the synthesis chart from raw spectra.
 *
 * Calculates the per-wavelength mean and +/-1 sigma band, samples up to
 * `maxSpectraLines` individual spectra, and returns the merged rows plus the
 * per-sampled-line colours in render order.
 */
export function buildSynthesisChartData(
  data: PreviewData,
  maxSpectraLines: number,
): { mergedData: Array<Record<string, number>>; lineColors: string[] } {
  const { spectra, wavelengths, targets, target_type } = data;

  if (spectra.length === 0 || wavelengths.length === 0) {
    return { mergedData: [], lineColors: [] };
  }

  const numWavelengths = wavelengths.length;
  const numSpectra = spectra.length;

  const minTarget = Math.min(...targets);
  const maxTarget = Math.max(...targets);

  // Calculate mean and std at each wavelength
  const means: number[] = [];
  const stds: number[] = [];

  for (let w = 0; w < numWavelengths; w++) {
    let sum = 0;
    for (let s = 0; s < numSpectra; s++) {
      sum += spectra[s][w];
    }
    const mean = sum / numSpectra;
    means.push(mean);

    let variance = 0;
    for (let s = 0; s < numSpectra; s++) {
      variance += Math.pow(spectra[s][w] - mean, 2);
    }
    const std = Math.sqrt(variance / numSpectra);
    stds.push(std);
  }

  // Sample spectra for individual lines
  const sampleIndices: number[] = [];
  if (numSpectra <= maxSpectraLines) {
    for (let i = 0; i < numSpectra; i++) {
      sampleIndices.push(i);
    }
  } else {
    const step = numSpectra / maxSpectraLines;
    for (let i = 0; i < maxSpectraLines; i++) {
      sampleIndices.push(Math.floor(i * step));
    }
  }

  const lineColors = sampleIndices.map((idx) =>
    getColorForTarget(targets[idx], target_type, minTarget, maxTarget),
  );

  const mergedData = wavelengths.map((wl, i) => {
    const entry: Record<string, number> = {
      wavelength: wl,
      mean: means[i],
      upper: means[i] + stds[i],
      lower: means[i] - stds[i],
    };
    sampleIndices.forEach((sampleIdx, sIdx) => {
      entry[`spectrum_${sIdx}`] = spectra[sampleIdx][i];
    });
    return entry;
  });

  return { mergedData, lineColors };
}
