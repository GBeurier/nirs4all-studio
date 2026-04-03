/**
 * Session restore helpers for playground state.
 *
 * The dedicated pipeline storage key is the source of truth for operators.
 * The broader playground session storage may still contain operators for
 * backward compatibility, but it should only be used when the pipeline state
 * key is missing or invalid.
 */

export function hasPersistedPlaygroundPipelineState(storedPipelineState: string | null): boolean {
  if (!storedPipelineState) {
    return false;
  }

  try {
    const parsed = JSON.parse(storedPipelineState);
    return Array.isArray(parsed);
  } catch {
    return false;
  }
}
