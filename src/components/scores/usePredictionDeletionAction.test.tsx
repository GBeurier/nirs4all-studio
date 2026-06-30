/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { PredictionDeletionReport } from '@/types/storage';

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: toastMocks,
}));

import { usePredictionDeletionAction, type UsePredictionDeletionActionInput } from './usePredictionDeletionAction';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function deletionReport(overrides: Partial<PredictionDeletionReport> = {}): PredictionDeletionReport {
  return {
    success: true,
    scope: 'chain',
    deleted_predictions: 2,
    deleted_arrays: 2,
    deleted_chains: 1,
    deleted_pipelines: 0,
    deleted_artifacts: 1,
    updated_chains: 0,
    ...overrides,
  };
}

async function renderHook(input: UsePredictionDeletionActionInput, queryClient = new QueryClient()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: ReturnType<typeof usePredictionDeletionAction> | undefined } = { current: undefined };

  function TestComponent() {
    result.current = usePredictionDeletionAction(input);
    return null;
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>
    );
  });

  return {
    result,
    queryClient,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
      toastMocks.error.mockReset();
      toastMocks.success.mockReset();
    },
  };
}

describe('usePredictionDeletionAction', () => {
  it('runs a successful deletion, invalidates related queries, closes the dialog, and toasts a summary', async () => {
    const deleteRequest = vi.fn().mockResolvedValue(deletionReport());
    const onDeleted = vi.fn();
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const mounted = await renderHook({ deleteRequest, onDeleted }, queryClient);

    await act(async () => {
      mounted.result.current!.setDeleteOpen(true);
    });
    expect(mounted.result.current!.deleteOpen).toBe(true);

    await act(async () => {
      await mounted.result.current!.handleDelete();
    });

    expect(deleteRequest).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(mounted.result.current!.deleteOpen).toBe(false);
    expect(mounted.result.current!.deleteBusy).toBe(false);
    expect(toastMocks.success).toHaveBeenCalledWith('2 predictions deleted · 1 chain pruned · 1 artifact file removed');

    await mounted.unmount();
  });

  it('stops before the request when validation fails', async () => {
    const deleteRequest = vi.fn();
    const mounted = await renderHook({
      deleteRequest,
      validate: () => 'Missing workspace',
    });

    await act(async () => {
      await mounted.result.current!.handleDelete();
    });

    expect(deleteRequest).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith('Missing workspace');
    expect(mounted.result.current!.deleteBusy).toBe(false);

    await mounted.unmount();
  });

  it('keeps the confirmation open when the backend reports no deletion', async () => {
    const deleteRequest = vi.fn().mockResolvedValue(deletionReport({
      success: false,
      deleted_predictions: 0,
      deleted_arrays: 0,
      deleted_chains: 0,
      deleted_artifacts: 0,
    }));
    const mounted = await renderHook({ deleteRequest });

    await act(async () => {
      mounted.result.current!.setDeleteOpen(true);
      await mounted.result.current!.handleDelete();
    });

    expect(toastMocks.error).toHaveBeenCalledWith('Nothing was deleted');
    expect(mounted.result.current!.deleteOpen).toBe(true);
    expect(mounted.result.current!.deleteBusy).toBe(false);

    await mounted.unmount();
  });
});
