/**
 * Build the merged Recharts rows for the aggregated dataset spectra chart.
 * Each row carries the `wavelength`, the `mean` value, and (when min/max are
 * supplied) a `range` tuple for the shaded band.
 */
export function buildSpectraChartData(
  wavelengths: number[],
  meanSpectrum: number[],
  minSpectrum?: number[],
  maxSpectrum?: number[],
): Array<Record<string, number | number[]>> {
  if (!wavelengths?.length || !meanSpectrum?.length) return [];
  return wavelengths.map((w, i) => {
    const point: Record<string, number | number[]> = { wavelength: w, mean: meanSpectrum[i] };
    if (minSpectrum && maxSpectrum) {
      point.range = [minSpectrum[i], maxSpectrum[i]];
    }
    return point;
  });
}
