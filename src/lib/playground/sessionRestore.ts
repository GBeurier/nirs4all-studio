/**
 * Session restore helpers for playground state.
 *
 * The dedicated pipeline storage key is the source of truth for operators.
 * The broader playground session storage may still contain operators for
 * backward compatibility, but it should only be used when the pipeline state
 * key is missing or invalid.
 */

export interface PersistedPlaygroundOperator {
  id: string;
  name: string;
  type: 'preprocessing' | 'splitting' | 'filter' | 'augmentation';
  params: Record<string, unknown>;
  enabled: boolean;
}

function parsePersistedPlaygroundOperators(
  storedState: string | null,
): PersistedPlaygroundOperator[] | null {
  if (!storedState) {
    return null;
  }

  try {
    const parsed = JSON.parse(storedState);
    return Array.isArray(parsed) ? (parsed as PersistedPlaygroundOperator[]) : null;
  } catch {
    return null;
  }
}

export function hasPersistedPlaygroundPipelineState(storedPipelineState: string | null): boolean {
  return parsePersistedPlaygroundOperators(storedPipelineState) !== null;
}

export function loadPersistedPlaygroundOperators(
  storedPipelineState: string | null,
  storedSessionState: string | null,
): PersistedPlaygroundOperator[] {
  const dedicatedOperators = parsePersistedPlaygroundOperators(storedPipelineState);
  if (dedicatedOperators !== null) {
    return dedicatedOperators;
  }
  void storedSessionState;
  return [];
}
