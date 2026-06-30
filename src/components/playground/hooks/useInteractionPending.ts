import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseInteractionPendingOptions {
  isFetching: boolean;
  isLoading: boolean;
  interactionTimeoutMs?: number;
  settleTimeoutMs?: number;
}

export interface UseInteractionPendingResult {
  interactionPending: boolean;
  triggerInteractionPending: () => void;
}

export function useInteractionPending({
  isFetching,
  isLoading,
  interactionTimeoutMs = 400,
  settleTimeoutMs = 150,
}: UseInteractionPendingOptions): UseInteractionPendingResult {
  const [interactionPending, setInteractionPending] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const triggerInteractionPending = useCallback(() => {
    clearPendingTimeout();
    setInteractionPending(true);
    timeoutRef.current = window.setTimeout(() => {
      setInteractionPending(false);
      timeoutRef.current = null;
    }, interactionTimeoutMs);
  }, [clearPendingTimeout, interactionTimeoutMs]);

  useEffect(() => () => {
    clearPendingTimeout();
  }, [clearPendingTimeout]);

  useEffect(() => {
    if (isFetching || isLoading) {
      clearPendingTimeout();
      setInteractionPending(true);
      return;
    }

    clearPendingTimeout();
    timeoutRef.current = window.setTimeout(() => {
      setInteractionPending(false);
      timeoutRef.current = null;
    }, settleTimeoutMs);
  }, [clearPendingTimeout, isFetching, isLoading, settleTimeoutMs]);

  return {
    interactionPending,
    triggerInteractionPending,
  };
}
