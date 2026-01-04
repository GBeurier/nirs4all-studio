/**
 * StepActions - Common action buttons for step configuration panels
 *
 * Provides consistent duplicate/remove buttons across all step renderers.
 * Extracted to reduce duplication and ensure consistent styling.
 *
 * Phase 3 Implementation - Component Refactoring
 */

import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface StepActionsProps {
  /** Step ID to operate on */
  stepId: string;

  /** Handler for duplicating the step */
  onDuplicate: (id: string) => void;

  /** Handler for removing the step */
  onRemove: (id: string) => void;

  /** Optional additional class names */
  className?: string;
}

/**
 * Standard action buttons shown at the bottom of step configuration panels.
 */
export function StepActions({
  stepId,
  onDuplicate,
  onRemove,
  className = "",
}: StepActionsProps) {
  return (
    <div className={`p-4 border-t border-border space-y-2 ${className}`}>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => onDuplicate(stepId)}
      >
        <Copy className="h-4 w-4 mr-2" />
        Duplicate Step
      </Button>
      <Button
        variant="destructive"
        size="sm"
        className="w-full"
        onClick={() => onRemove(stepId)}
      >
        <Trash2 className="h-4 w-4 mr-2" />
        Remove Step
      </Button>
    </div>
  );
}
