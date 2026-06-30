export const PLAYGROUND_CHART_IDS = [
  'spectra',
  'histogram',
  'pca',
  'folds',
  'repetitions',
] as const;

export type PlaygroundChartId = typeof PLAYGROUND_CHART_IDS[number];

export function isPlaygroundChartId(value: string): value is PlaygroundChartId {
  return PLAYGROUND_CHART_IDS.includes(value as PlaygroundChartId);
}
