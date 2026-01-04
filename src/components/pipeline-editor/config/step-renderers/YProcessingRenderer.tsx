/**
 * YProcessingRenderer - Y-Processing step configuration renderer
 *
 * Specialized renderer for target variable processing steps.
 * Wraps the existing YProcessingPanel component.
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  YProcessingPanel,
  defaultYProcessingConfig,
} from "../../YProcessingPanel";
import { StepActions } from "./StepActions";
import type { StepRendererProps } from "./types";

/**
 * YProcessingRenderer - Target variable scaling/transformation UI
 */
export function YProcessingRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
}: StepRendererProps) {
  // Initialize config if not present
  const config = step.yProcessingConfig ?? defaultYProcessingConfig();

  const handleConfigChange = useCallback(
    (newConfig: typeof config) => {
      onUpdate(step.id, {
        yProcessingConfig: newConfig,
      });
    },
    [onUpdate, step.id]
  );

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4">
          <YProcessingPanel config={config} onChange={handleConfigChange} />
        </div>
      </ScrollArea>

      <StepActions
        stepId={step.id}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </>
  );
}
