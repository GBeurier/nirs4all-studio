/**
 * Formats a parameter key into a human-readable label.
 * Replaces underscores with spaces and handles camelCase.
 *
 * @example
 * formatParamLabel("n_components") // "n components"
 * formatParamLabel("learningRate") // "learning rate"
 * formatParamLabel("max_iter") // "max iter"
 */
export function formatParamLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}
