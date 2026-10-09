import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useApiErrorToast } from "@/hooks/useApiErrorToast";

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
  nothingDeletedMessage,
  failureMessage,
}: UsePredictionDeletionActionInput) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const notifyApiError = useApiErrorToast();
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
        toast.error(nothingDeletedMessage ?? t('results.scores.delete.nothingDeleted'));
        return;
      }

      await invalidatePredictionRelatedQueries(queryClient);
      onDeleted?.();
      setDeleteOpen(false);
      toast.success(formatPredictionDeletionSummary(result, t));
    } catch (error) {
      notifyApiError(error, failureMessage ?? t('results.scores.delete.failed'));
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteRequest, failureMessage, nothingDeletedMessage, notifyApiError, onDeleted, queryClient, t, validate]);

  return {
    deleteOpen,
    setDeleteOpen,
    deleteBusy,
    handleDelete,
  };
}
