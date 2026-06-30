export interface ScoreSourceSignatureInput {
  model_name: string | null;
  model_class: string | null;
  preprocessings: string | null;
}

export interface ScoreSourceSignatureParts {
  modelClass: string;
  modelName: string;
  preprocessings: string;
  bestParams: string;
}

export function stableSerialize(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${stableSerialize(v)}`)
      .join(",")}}`;
  }
  return String(value);
}

export function normalizeToken(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

export function normalizePreprocessings(value: string | null | undefined): string {
  return normalizeToken(value).replace(/\s+/g, "");
}

export function scoreSourceSignatureParts(
  source: ScoreSourceSignatureInput,
  params: unknown,
): ScoreSourceSignatureParts {
  return {
    modelClass: normalizeToken(source.model_class),
    modelName: normalizeToken(source.model_name),
    preprocessings: normalizePreprocessings(source.preprocessings),
    bestParams: stableSerialize(params),
  };
}

export function scoreSourceVariantKey(
  source: ScoreSourceSignatureInput,
  params: unknown,
): string {
  return [
    normalizeToken(source.model_name),
    normalizeToken(source.model_class),
    normalizePreprocessings(source.preprocessings),
    stableSerialize(params),
  ].join("::");
}

export function scoreSourceDisplayKey(source: ScoreSourceSignatureInput): string {
  return [
    normalizeToken(source.model_name),
    normalizeToken(source.model_class),
    normalizePreprocessings(source.preprocessings),
  ].join("::");
}
