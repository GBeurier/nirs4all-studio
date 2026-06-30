import { describe, expect, it } from 'vitest';

import {
  CONFUSION_MATRIX_EMPTY_DESCRIPTION,
  CONFUSION_MATRIX_NO_LABELS_DESCRIPTION,
  getConfusionMatrixEmptyDescription,
  getConfusionMatrixNoLabelsDescription,
  getConfusionMatrixTooltipTitle,
  getConfusionMatrixTotalSamplesLabel,
} from '@/lib/inspector/confusionMatrixPresentation';

describe('inspector confusion matrix presentation helpers', () => {
  it('falls back to stable empty-state descriptions', () => {
    expect(getConfusionMatrixEmptyDescription(null)).toBe(CONFUSION_MATRIX_EMPTY_DESCRIPTION);
    expect(getConfusionMatrixEmptyDescription(' classification only ')).toBe('classification only');
    expect(getConfusionMatrixNoLabelsDescription(null)).toBe(CONFUSION_MATRIX_NO_LABELS_DESCRIPTION);
    expect(getConfusionMatrixNoLabelsDescription(' no labels ')).toBe('no labels');
  });

  it('formats tooltip labels', () => {
    expect(getConfusionMatrixTooltipTitle('cat', 'dog')).toBe('cat → dog');
    expect(getConfusionMatrixTotalSamplesLabel(42)).toBe('Total samples: 42');
  });
});
