import { useCallback, useEffect, useRef } from "react";

interface UseDebouncedWriteOptions {
  delayMs?: number;
  /** Ignore the write passed on the first render (state that was just loaded from storage). */
  skipInitialWrite?: boolean;
  /** Identifies the storage target; a pending write for the previous scope is flushed when it changes. */
  scopeKey?: string;
}

/**
 * Debounces a browser-storage write so rapid edits produce one write.
 *
 * `write` must be memoized on the state it persists. Passing `null` means "nothing to
 * persist" and discards any pending write. A pending write is flushed on unmount and
 * when the page is hidden or unloaded, so no draft is lost.
 */
export function useDebouncedWrite(
  write: (() => void) | null,
  { delayMs = 500, skipInitialWrite = false, scopeKey }: UseDebouncedWriteOptions = {},
): { cancel: () => void } {
  const pendingRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextRef = useRef(skipInitialWrite);
  const scopeRef = useRef(scopeKey);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
  }, []);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    cancel();
    pending?.();
  }, [cancel]);

  useEffect(() => {
    if (scopeRef.current !== scopeKey) {
      flush();
      scopeRef.current = scopeKey;
    }
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }
    if (!write) {
      cancel();
      return;
    }
    pendingRef.current = write;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, delayMs);
  }, [write, delayMs, scopeKey, cancel, flush]);

  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  return { cancel };
}
