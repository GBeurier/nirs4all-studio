export interface PlaygroundOperatorModeInput {
  operators?: Array<{
    enabled?: boolean;
  }> | null;
}

export function isPlaygroundRawDataMode(operators: PlaygroundOperatorModeInput['operators']): boolean {
  return !operators?.some(operator => operator.enabled);
}
