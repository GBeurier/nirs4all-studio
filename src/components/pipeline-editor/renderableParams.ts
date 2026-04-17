import type { ParameterSweep, PipelineStep, StepOption } from "./types";

function inferSweepDisplayValue(sweep: ParameterSweep): unknown {
  switch (sweep.type) {
    case "range":
    case "log_range":
      return sweep.from;
    case "or":
      return sweep.choices?.[0];
    case "grid": {
      const firstGridValues = Object.values(sweep.gridParams || {})[0];
      return firstGridValues?.[0];
    }
    default:
      return undefined;
  }
}

export function getRenderableStepParams(
  step: PipelineStep,
  currentOption?: StepOption
): PipelineStep["params"] {
  const sweeps = step.paramSweeps;
  if (!sweeps || Object.keys(sweeps).length === 0) {
    return step.params;
  }

  const mergedParams: Record<string, unknown> = {};
  let changed = false;

  for (const [key, value] of Object.entries(currentOption?.defaultParams || {})) {
    mergedParams[key] = value;
    if (!(key in step.params)) {
      changed = true;
    }
  }

  for (const [key, value] of Object.entries(step.params)) {
    mergedParams[key] = value;
  }

  for (const [key, sweep] of Object.entries(sweeps)) {
    if (mergedParams[key] !== undefined) {
      continue;
    }
    const inferredValue = inferSweepDisplayValue(sweep);
    if (inferredValue !== undefined) {
      mergedParams[key] = inferredValue;
      changed = true;
    }
  }

  return changed ? mergedParams : step.params;
}
