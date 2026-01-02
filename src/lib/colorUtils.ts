import { ColorConfig, ProcessedData } from '@/types/spectral';

export function getSampleColor(
  index: number,
  data: ProcessedData,
  colorConfig: ColorConfig,
  selectedSample: number | null
): string {
  if (selectedSample === index) return 'hsl(var(--primary))';

  const { mode, metadataKey } = colorConfig;

  if (mode === 'dataset' && data.datasetSource) {
    const sources = [...new Set(data.datasetSource)];
    const sourceIndex = sources.indexOf(data.datasetSource[index]);
    const hue = sourceIndex === 0 ? 217 : sourceIndex === 1 ? 142 : (sourceIndex * 60) % 360;
    return `hsl(${hue}, 70%, 50%)`;
  }

  if (mode === 'metadata' && metadataKey && data.metadata?.[index]) {
    const value = data.metadata[index][metadataKey];
    if (typeof value === 'number') {
      const allValues = data.metadata.map(m => m[metadataKey] as number).filter(v => typeof v === 'number');
      const min = Math.min(...allValues);
      const max = Math.max(...allValues);
      const t = (value - min) / (max - min + 0.001);
      const hue = 240 - t * 180;
      return `hsl(${hue}, 70%, 50%)`;
    } else {
      const allValues = [...new Set(data.metadata.map(m => m[metadataKey]))];
      const valIndex = allValues.indexOf(value);
      const hue = (valIndex * 137.5) % 360;
      return `hsl(${hue}, 60%, 50%)`;
    }
  }

  // Default: color by target (Y)
  const yMin = Math.min(...data.y);
  const yMax = Math.max(...data.y);
  const t = (data.y[index] - yMin) / (yMax - yMin + 0.001);
  const hue = 240 - t * 180;
  return `hsl(${hue}, 70%, 50%)`;
}

export function getMetadataKeys(data: ProcessedData): string[] {
  if (!data.metadata || data.metadata.length === 0) return [];
  return Object.keys(data.metadata[0]);
}

export function getDatasetSources(data: ProcessedData): string[] {
  if (!data.datasetSource) return [];
  return [...new Set(data.datasetSource)];
}
