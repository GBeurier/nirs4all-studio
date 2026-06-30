import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  formatPredictionDeletionSummary,
  invalidatePredictionRelatedQueries,
} from '@/lib/prediction-deletion';
import type { PredictionDeletionReport } from '@/types/storage';

export interface UsePredictionDeletionActionInput {
  deleteRequest: () => Promise<PredictionDeletionReport>;
  validate?: () => string | null;
  onDeleted?: () => void;
  nothingDeletedMessage?: string;
  failureMessage?: string;
}

export function usePredictionDeletionAction({
  deleteRequest,
  validate,
  onDeleted,
  nothingDeletedMessage = 'Nothing was deleted',
  failureMessage = 'Deletion failed',
}: UsePredictionDeletionActionInput) {
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const handleDelete = useCallback(async () => {
    const validationMessage = validate?.();
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }

    setDeleteBusy(true);
    try {
      const result = await deleteRequest();
      if (!result.success) {
        toast.error(nothingDeletedMessage);
        return;
      }

      await invalidatePredictionRelatedQueries(queryClient);
      onDeleted?.();
      setDeleteOpen(false);
      toast.success(formatPredictionDeletionSummary(result));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failureMessage);
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteRequest, failureMessage, nothingDeletedMessage, onDeleted, queryClient, validate]);

  return {
    deleteOpen,
    setDeleteOpen,
    deleteBusy,
    handleDelete,
  };
}
