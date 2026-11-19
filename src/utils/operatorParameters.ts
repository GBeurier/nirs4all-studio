/** Translate editor controls into canonical constructor parameters. */
export function normalizeOperatorParameters(classPath: string, input: Record<string, unknown>): Record<string, unknown> {
  const params = { ...input };
  // Native Methods parameters already follow their manifest's wire schema.
  if (classPath.startsWith('n4m:')) return params;
  const definition = augmentationDefinitions.find(node => node.classPath === classPath);
  if (definition && !definition.parameters.some(param => param.name === 'variation_scope') && params.variation_scope === 'sample') {
    // Old palette versions added this default even to operators without a
    // scope parameter. Preserve their actual historical per-sample behavior.
    delete params.variation_scope;
  }
  for (const key of Object.keys(params)) {
    if (!key.endsWith('_min')) continue;
    const name = key.slice(0, -4);
    if (!(`${name}_max` in params)) continue;
    const lower = params[key];
    const upper = params[`${name}_max`];
    if (lower != null || upper != null) {
      if (lower == null || upper == null) throw new Error(`Both bounds of ${name} must be supplied.`);
      params[name] = [lower, upper];
    }
    delete params[key];
    delete params[`${name}_max`];
  }
  if (classPath.endsWith('.LogTransform') && typeof params.base === 'string') {
    params.base = params.base === 'e' ? Math.E : Number(params.base);
  }
  return params;
}
import augmentationDefinitions from '@/data/nodes/definitions/augmentation/transforms.json';

