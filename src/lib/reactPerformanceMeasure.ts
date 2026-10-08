/** Keep React component timings without cloning its potentially huge prop diff. */
export function omitReactPerformancePropDiff(measure: Performance['measure']): Performance['measure'] {
  return function patchedMeasure(...args: Parameters<Performance['measure']>) {
    const [name, options] = args;
    const devtools = typeof name === 'string' && name.startsWith('\u200b') && typeof options === 'object'
      ? options?.detail?.devtools : undefined;
    const properties = devtools?.properties;
    // React 19 uses this exact track/name/header for changed component props.
    // Preserve scheduler and error metadata, and all other User Timing calls.
    const reactPropDiff = devtools?.track === 'Components ⚛'
      && Array.isArray(properties) && properties[0]?.[0] === 'Changed Props';
    if (reactPropDiff && typeof options === 'object') {
      const { properties: _omitted, ...metadata } = devtools;
      args[1] = { ...options, detail: { ...options.detail, devtools: metadata } };
    }
    try {
      return measure(...args);
    } catch (error) {
      // Retain the existing React prop-diff crash guard for clone refusals.
      if (reactPropDiff && error instanceof DOMException && error.name === 'DataCloneError') {
        return undefined as unknown as PerformanceMeasure;
      }
      throw error;
    }
  };
}
