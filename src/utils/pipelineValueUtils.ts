export type PipelineParamRecord = Record<string, unknown>;

export function cloneParamValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => cloneParamValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, childValue]) => [
        key,
        cloneParamValue(childValue),
      ])
    );
  }
  return value;
}

export function castParamRecord(params: Record<string, unknown> | undefined): PipelineParamRecord {
  if (!params) {
    return {};
  }
  const result: PipelineParamRecord = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      result[key] = cloneParamValue(value);
    }
  }
  return result;
}
