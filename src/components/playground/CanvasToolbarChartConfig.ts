import type { ChartType } from '@/context/usePlaygroundView';
import { PLAYGROUND_CHART_IDS } from '@/lib/playground/chartIds';

export interface ChartConfig {
  id: ChartType;
  label: string;
  requiresFolds?: boolean;
  requiresRepetitions?: boolean;
}

const CHART_CONFIG_BY_ID: Record<ChartType, Omit<ChartConfig, 'id'>> = {
  spectra: { label: 'Spectra' },
  histogram: { label: 'Y Hist' },
  pca: { label: 'PCA' },
  folds: { label: 'Folds', requiresFolds: true },
  repetitions: { label: 'Reps', requiresRepetitions: true },
};

export const CHART_CONFIG: ChartConfig[] = PLAYGROUND_CHART_IDS.map((id) => ({
  id,
  ...CHART_CONFIG_BY_ID[id],
}));
