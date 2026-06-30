import { useCallback, useState } from "react";

import type { PipelineValidationResult } from "./types";

export interface UseValidationBeforeExportOptions {
  /** Validate function */
  validateNow: () => void;
  /** Get current result */
  result: PipelineValidationResult;
  /** Callback when export is allowed */
  onExport: () => void;
}

/**
 * Hook to handle validation before export workflow.
 */
export function useValidationBeforeExport({
  validateNow,
  result,
  onExport,
}: UseValidationBeforeExportOptions) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const triggerExport = useCallback(() => {
    // First validate
    validateNow();
    // Then show dialog
    setDialogOpen(true);
  }, [validateNow]);

  const handleExport = useCallback(() => {
    if (result.isValid) {
      onExport();
    }
  }, [result.isValid, onExport]);

  return {
    dialogOpen,
    setDialogOpen,
    triggerExport,
    handleExport,
    canExport: result.isValid,
  };
}
