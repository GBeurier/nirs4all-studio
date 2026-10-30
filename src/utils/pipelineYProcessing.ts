/** Hydrate library parameters into controls without replacing imported values. */
export function hydrateYProcessingParams(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const params = { ...input };
  if (name === "MinMaxScaler" && Array.isArray(params.feature_range)) {
    params.feature_range_min ??= params.feature_range[0];
    params.feature_range_max ??= params.feature_range[1];
    delete params.feature_range;
  }
  if (name === "RangeDiscretizer") {
    params.bins ??= params.ranges ?? 5;
    delete params.ranges;
  }
  return params;
}

/** Convert target-processing editor values to the library's public parameters. */
export function normalizeYProcessingParams(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const params = { ...input };
  if (name === "MinMaxScaler" && ("feature_range_min" in params || "feature_range_max" in params)) {
    params.feature_range = [params.feature_range_min ?? 0, params.feature_range_max ?? 1];
    delete params.feature_range_min;
    delete params.feature_range_max;
  }
  if (name === "RangeDiscretizer" && ("bins" in params || "ranges" in params)) {
    let bins = params.bins ?? params.ranges;
    delete params.ranges;
    if (typeof bins === "string") {
      const value = bins.trim();
      if (/^[1-9]\d*$/.test(value)) bins = Number(value);
      else if (value.startsWith("[")) {
        try { bins = JSON.parse(value); }
        catch { throw new Error("Custom bin boundaries must be an increasing list of finite numbers."); }
      } else {
        const values = value.split(",").map(part => part.trim());
        bins = values.every(Boolean) ? values.map(Number) : undefined;
      }
    }
    if (typeof bins === "number") {
      if (!Number.isSafeInteger(bins) || bins < 1) throw new Error("The number of bins must be a positive integer.");
    } else if (!Array.isArray(bins) || bins.length === 0 || bins.some((value, index) =>
      typeof value !== "number" || !Number.isFinite(value) || (index > 0 && value <= bins[index - 1]))) {
      throw new Error("Custom bin boundaries must be an increasing list of finite numbers.");
    }
    params.bins = bins;
  }
  return params;
}
