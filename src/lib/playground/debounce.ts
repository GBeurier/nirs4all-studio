/**
 * Debounce utilities for playground
 *
 * Provides hooks and utilities for debouncing API calls
 * and handling slider value commits.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Debounce delay constants
 */
export const DEBOUNCE_DELAYS = {
  /** Default debounce for pipeline structure changes (add/remove/reorder) */
  STRUCTURE_CHANGE: 80,
  /** Debounce for slider changes */
  SLIDER_CHANGE: 120,
  /** Debounce for text input changes */
  TEXT_CHANGE: 150,
  /** Minimum delay before showing loading state */
  LOADING_DELAY: 50,
} as const;

/**
 * Hook that returns a debounced value
 *
 * @param value - The value to debounce
 * @param delay - Debounce delay in milliseconds
 * @returns The debounced value
 */
export function useDebouncedValue<T>(value: T, delay: number = DEBOUNCE_DELAYS.STRUCTURE_CHANGE): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook that returns a debounced callback
 * The callback is called only after the specified delay has passed
 * without the function being called again.
 *
 * @param callback - The callback to debounce
 * @param delay - Debounce delay in milliseconds
 * @returns A debounced version of the callback
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => void>(
  callback: T,
  delay: number = DEBOUNCE_DELAYS.STRUCTURE_CHANGE
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);

  // Update callback ref when callback changes
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const debouncedCallback = useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }, [delay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback as T;
}

/**
 * Hook for text input with commit-on-blur/enter behavior
 *
 * Maintains local state for immediate UI feedback while editing.
 * Only commits to parent state on:
 * - Blur (focus loss)
 * - Enter key press
 *
 * This prevents intermediate/invalid values from triggering execution.
 *
 * @param externalValue - The current value from parent state
 * @param onCommit - Callback when value is committed (blur/enter)
 * @returns Object with value, onChange, onBlur, onKeyDown, and reset
 */
export function useCommittedInput(
  externalValue: string,
  onCommit: (value: string) => void
): {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  reset: () => void;
  isDirty: boolean;
} {
  const [localValue, setLocalValue] = useState<string>(externalValue);
  const [isDirty, setIsDirty] = useState(false);
  const lastCommittedRef = useRef(externalValue);

  // Sync with external value when it changes (from undo/redo, reset, etc.)
  // but only if we're not actively editing
  useEffect(() => {
    if (!isDirty && externalValue !== lastCommittedRef.current) {
      setLocalValue(externalValue);
      lastCommittedRef.current = externalValue;
    }
  }, [externalValue, isDirty]);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    setIsDirty(true);
  }, []);

  const commit = useCallback(() => {
    if (isDirty && localValue !== lastCommittedRef.current) {
      onCommit(localValue);
      lastCommittedRef.current = localValue;
    }
    setIsDirty(false);
  }, [localValue, isDirty, onCommit]);

  const onBlur = useCallback(() => {
    commit();
  }, [commit]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      // Optionally blur the input after enter
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      // Revert to last committed value on Escape
      setLocalValue(lastCommittedRef.current);
      setIsDirty(false);
      (e.target as HTMLInputElement).blur();
    }
  }, [commit]);

  const reset = useCallback(() => {
    setLocalValue(externalValue);
    lastCommittedRef.current = externalValue;
    setIsDirty(false);
  }, [externalValue]);

  return {
    value: localValue,
    onChange,
    onBlur,
    onKeyDown,
    reset,
    isDirty,
  };
}

/**
 * Hook for handling slider changes with commit behavior
 *
 * Returns local value for immediate UI feedback and a commit function
 * for triggering actual updates (on mouse release).
 *
 * @param initialValue - Initial slider value
 * @param onCommit - Callback when value is committed
 * @returns Object with value, onChange, onCommit
 */
export function useSliderWithCommit<T>(
  initialValue: T,
  onCommit: (value: T) => void
): {
  value: T;
  onChange: (value: T) => void;
  onValueCommit: (value: T) => void;
  reset: (value: T) => void;
} {
  const [localValue, setLocalValue] = useState<T>(initialValue);
  const isInitialMount = useRef(true);

  // Sync with external value changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setLocalValue(initialValue);
  }, [initialValue]);

  const onChange = useCallback((value: T) => {
    setLocalValue(value);
  }, []);

  const onValueCommit = useCallback((value: T) => {
    setLocalValue(value);
    onCommit(value);
  }, [onCommit]);

  const reset = useCallback((value: T) => {
    setLocalValue(value);
  }, []);

  return {
    value: localValue,
    onChange,
    onValueCommit,
    reset,
  };
}

/**
 * Create a cancellable debounced function
 *
 * @param fn - Function to debounce
 * @param delay - Debounce delay
 * @returns Object with the debounced function and cancel method
 */
export function createDebouncedFn<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): { call: T; cancel: () => void; flush: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const call = ((...args: Parameters<T>) => {
    lastArgs = args;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
      lastArgs = null;
    }, delay);
  }) as T;

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastArgs = null;
    }
  };

  const flush = () => {
    if (timeoutId && lastArgs) {
      clearTimeout(timeoutId);
      fn(...lastArgs);
      timeoutId = null;
      lastArgs = null;
    }
  };

  return { call, cancel, flush };
}

/**
 * Hook to track if we're within a debounce window
 * Useful for showing "updating..." states
 *
 * @param isDebouncing - Whether a debounce is in progress
 * @param delay - Minimum time to show the debouncing state
 * @returns Whether to show the debouncing indicator
 */
export function useDebounceIndicator(
  isDebouncing: boolean,
  delay: number = DEBOUNCE_DELAYS.LOADING_DELAY
): boolean {
  const [showIndicator, setShowIndicator] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isDebouncing) {
      // Start showing indicator after a short delay
      timeoutRef.current = setTimeout(() => {
        setShowIndicator(true);
      }, delay);
    } else {
      // Immediately hide when debounce ends
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setShowIndicator(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isDebouncing, delay]);

  return showIndicator;
}
