import { describe, expect, it } from 'vitest';

import {
  getConfusionMatrixEmptyDescription,
  getConfusionMatrixNoLabelsDescription,
  getConfusionMatrixTooltipTitle,
  getConfusionMatrixTotalSamplesLabel,
} from '@/lib/inspector/confusionMatrixPresentation';
import { tStub } from './helpers/i18nStub';

describe('inspector confusion matrix presentation helpers', () => {
  it('falls back to stable empty-state descriptions', () => {
    expect(getConfusionMatrixEmptyDescription(null, tStub)).toBe('inspector.charts.empty.confusion');
    expect(getConfusionMatrixEmptyDescription(' classification only ', tStub)).toBe('classification only');
    expect(getConfusionMatrixNoLabelsDescription(null, tStub)).toBe('inspector.charts.empty.confusionNoLabels');
    expect(getConfusionMatrixNoLabelsDescription(' no labels ', tStub)).toBe('no labels');
  });

  it('formats tooltip labels', () => {
    expect(getConfusionMatrixTooltipTitle('cat', 'dog')).toBe('cat → dog');
    expect(getConfusionMatrixTotalSamplesLabel(42, tStub)).toBe('inspector.charts.tooltip.totalSamples {"value":42}');
  });
});
