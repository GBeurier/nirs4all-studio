import type { PlaygroundStep } from '@/types/playground';

export interface SourceOption {
  /** Unique identifier for this source */
  id: string;
  /** Display label */
  label: string;
  /** Description of the source */
  description?: string;
  /** Type of source (for icon) */
  type: 'original' | 'preprocessor' | 'splitter' | 'model' | 'branch';
  /** Position in pipeline (0 = original input) */
  position: number;
  /** Whether this source is currently available */
  available: boolean;
}

function inferSourceType(step: PlaygroundStep): SourceOption['type'] {
  const name = step.name?.toLowerCase() ?? '';
  const type = step.type?.toLowerCase() ?? '';

  if (type.includes('split') || name.includes('split') || name.includes('kfold')) {
    return 'splitter';
  }
  if (type.includes('model') || name.includes('pls') || name.includes('regress')) {
    return 'model';
  }
  if (name.includes('branch')) {
    return 'branch';
  }
  return 'preprocessor';
}

export function buildSourceOptions(
  pipelineSteps: PlaygroundStep[],
  currentStepIndex: number
): SourceOption[] {
  const options: SourceOption[] = [
    {
      id: 'original',
      label: 'Original Input',
      description: 'Raw input data before any processing',
      type: 'original',
      position: 0,
      available: true,
    },
  ];

  pipelineSteps.forEach((step, idx) => {
    if (idx < currentStepIndex) {
      options.push({
        id: `step_${idx}`,
        label: step.name ?? `Step ${idx + 1}`,
        description: step.type ?? undefined,
        type: inferSourceType(step),
        position: idx + 1,
        available: true,
      });
    }
  });

  return options;
}
