import type { FoldsInfo } from '@/types/playground';

export type FoldsTxtBuildResult =
  | { success: true; content: string }
  | { success: false; error: string };

export interface FoldsTxtBuildOptions {
  generatedAt?: string;
}

export function buildFoldsTxt(
  folds: FoldsInfo,
  options: FoldsTxtBuildOptions = {},
): FoldsTxtBuildResult {
  if (!folds || folds.n_folds === 0) {
    return {
      success: false,
      error: 'No folds data to export',
    };
  }

  const { generatedAt = new Date().toISOString() } = options;
  const lines: string[] = [
    '# nirs4all folds export',
    `# Splitter: ${folds.splitter_name ?? 'unknown'}`,
    `# Folds: ${folds.n_folds}`,
    `# Generated: ${generatedAt}`,
    '',
  ];

  folds.folds.forEach((fold, i) => {
    lines.push(`# Fold ${i + 1}`);
    lines.push(`fold_${i + 1}_train:${fold.train_indices.join(',')}`);
    lines.push(`fold_${i + 1}_test:${fold.test_indices.join(',')}`);
    lines.push('');
  });

  if (folds.fold_labels && folds.fold_labels.length > 0) {
    lines.push('# Fold labels (sample_index -> fold_number)');
    folds.fold_labels.forEach((foldLabel, sampleIdx) => {
      lines.push(`${sampleIdx}:${foldLabel}`);
    });
  }

  return {
    success: true,
    content: lines.join('\n'),
  };
}
