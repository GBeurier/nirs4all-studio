export const CONFUSION_MATRIX_EMPTY_DESCRIPTION = 'This panel needs classification chains with prediction arrays for the selected partition.';
export const CONFUSION_MATRIX_NO_LABELS_DESCRIPTION = 'The selected chains did not produce discrete labels for this partition.';

export function getConfusionMatrixEmptyDescription(reason: string | null | undefined): string {
  return reason?.trim() || CONFUSION_MATRIX_EMPTY_DESCRIPTION;
}

export function getConfusionMatrixNoLabelsDescription(reason: string | null | undefined): string {
  return reason?.trim() || CONFUSION_MATRIX_NO_LABELS_DESCRIPTION;
}

export function getConfusionMatrixTooltipTitle(trueLabel: string, predLabel: string): string {
  return `${trueLabel} \u2192 ${predLabel}`;
}

export function getConfusionMatrixTotalSamplesLabel(totalSamples: number): string {
  return `Total samples: ${totalSamples}`;
}
