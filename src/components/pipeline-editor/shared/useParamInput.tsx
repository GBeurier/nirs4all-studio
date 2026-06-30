/**
 * useParamInput Hook
 *
 * Extracts parameter input rendering logic from StepConfigPanel.
 * Provides a reusable hook for rendering parameter inputs with sweep support.
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { useCallback } from "react";
import type { ParameterSweep } from "../types";
import { parameterInfo, selectParamKeys } from "./paramInputOptions";
import {
  BooleanParamInput,
  SelectParamInput,
  StructuredParamInput,
  TextParamInput,
} from "./paramInputRenderers";

interface UseParamInputOptions {
  paramSweeps?: Record<string, ParameterSweep>;
  onParamChange: (key: string, value: unknown) => void;
  onSweepChange: (key: string, sweep: ParameterSweep | undefined) => void;
}

/**
 * Hook that provides a render function for parameter inputs with sweep support.
 */
export function useParamInput({
  paramSweeps,
  onParamChange,
  onSweepChange,
}: UseParamInputOptions) {
  const renderParamInput = useCallback(
    (key: string, value: unknown) => {
      const info = parameterInfo[key];
      const sweep = paramSweeps?.[key];
      const hasSweepActive = !!sweep;

      // Boolean parameters
      if (typeof value === "boolean") {
        return (
          <BooleanParamInput
            key={key}
            paramKey={key}
            value={value}
            info={info}
            sweep={sweep}
            hasSweepActive={hasSweepActive}
            onParamChange={onParamChange}
            onSweepChange={onSweepChange}
          />
        );
      }

      // Arrays / objects / null use a structured JSON fallback editor.
      if (isStructuredParamValue(value)) {
        return (
          <StructuredParamInput
            key={key}
            paramKey={key}
            value={value}
            info={info}
            onParamChange={onParamChange}
          />
        );
      }

      // Select parameters for known options
      if (selectParamKeys.has(key)) {
        return (
          <SelectParamInput
            key={key}
            paramKey={key}
            value={typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : ""}
            info={info}
            sweep={sweep}
            hasSweepActive={hasSweepActive}
            onParamChange={onParamChange}
            onSweepChange={onSweepChange}
          />
        );
      }

      // Number or string parameters
      return (
        <TextParamInput
          key={key}
          paramKey={key}
          value={typeof value === "number" || typeof value === "string" ? value : String(value ?? "")}
          info={info}
          sweep={sweep}
          hasSweepActive={hasSweepActive}
          onParamChange={onParamChange}
          onSweepChange={onSweepChange}
        />
      );
    },
    [paramSweeps, onParamChange, onSweepChange]
  );

  return { renderParamInput };
}

function isStructuredParamValue(value: unknown): value is Record<string, unknown> | unknown[] | null {
  return value === null || Array.isArray(value) || (typeof value === "object" && value !== null);
}

export default useParamInput;
