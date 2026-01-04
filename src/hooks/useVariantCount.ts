/**
 * Hook for counting pipeline variants using nirs4all backend.
 *
 * This delegates variant counting to the nirs4all library's count_combinations
 * function, ensuring accurate counts that match what the library will generate.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { PipelineStep } from "@/types/pipelines";
import { api } from "@/api/client";

export interface VariantCountResult {
  /** Total number of pipeline variants */
  count: number;
  /** Per-step breakdown: { stepId: { name, count } } */
  breakdown: Record<string, { name: string; count: number }>;
  /** Warning message for large search spaces */
  warning?: string;
  /** Error message if counting failed */
  error?: string;
  /** Whether the count is currently being calculated */
  isLoading: boolean;
}

interface CountVariantsResponse {
  count: number;
  breakdown: Record<string, { name: string; count: number }>;
  warning?: string;
  error?: string;
  nirs4all_format?: unknown[];
}

/**
 * Hook that counts pipeline variants by calling the nirs4all backend.
 *
 * @param steps - The pipeline steps to count variants for
 * @param debounceMs - Debounce delay in milliseconds (default 300)
 * @returns VariantCountResult with count, breakdown, and loading state
 *
 * @example
 * ```tsx
 * function PipelineEditor({ steps }) {
 *   const { count, breakdown, isLoading, warning } = useVariantCount(steps);
 *
 *   return (
 *     <div>
 *       {isLoading ? "Calculating..." : `${count} variants`}
 *       {warning && <span className="text-amber-500">{warning}</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useVariantCount(
  steps: PipelineStep[],
  debounceMs = 300
): VariantCountResult {
  const [result, setResult] = useState<VariantCountResult>({
    count: 1,
    breakdown: {},
    isLoading: false,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const countVariants = useCallback(async (stepsToCount: PipelineStep[]) => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // If no steps, return 1 variant
    if (!stepsToCount || stepsToCount.length === 0) {
      setResult({
        count: 1,
        breakdown: {},
        isLoading: false,
      });
      return;
    }

    setResult((prev) => ({ ...prev, isLoading: true }));

    try {
      abortControllerRef.current = new AbortController();

      // Convert steps to the format expected by the API
      const stepsData = stepsToCount.map((step) => ({
        id: step.id,
        type: step.type,
        name: step.name,
        params: step.params || {},
        generator: step.generator,
        children: step.children?.map((child) => ({
          id: child.id,
          type: child.type,
          name: child.name,
          params: child.params || {},
          generator: child.generator,
        })),
      }));

      const response = await api.post<CountVariantsResponse>(
        "/pipelines/count-variants",
        { steps: stepsData },
        { signal: abortControllerRef.current.signal }
      );

      setResult({
        count: response.count || 1,
        breakdown: response.breakdown || {},
        warning: response.warning,
        error: response.error,
        isLoading: false,
      });
    } catch (error) {
      // Ignore abort errors
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      console.error("Failed to count variants:", error);

      // Fallback to simple count
      setResult({
        count: stepsToCount.length > 0 ? 1 : 0,
        breakdown: {},
        error: "Failed to calculate variant count",
        isLoading: false,
      });
    }
  }, []);

  // Debounced effect to count variants when steps change
  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      countVariants(steps);
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [steps, debounceMs, countVariants]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return result;
}

/**
 * Format a variant count for display with appropriate units.
 *
 * @param count - The variant count to format
 * @returns Formatted string like "1", "1.2K", "3.5M"
 */
export function formatVariantCount(count: number): string {
  if (count < 1000) {
    return count.toString();
  }
  if (count < 1_000_000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  if (count < 1_000_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  return `${(count / 1_000_000_000).toFixed(1)}B`;
}

/**
 * Get severity level based on variant count.
 *
 * @param count - The variant count
 * @returns "low" | "medium" | "high" | "extreme"
 */
export function getVariantCountSeverity(
  count: number
): "low" | "medium" | "high" | "extreme" {
  if (count <= 100) return "low";
  if (count <= 1000) return "medium";
  if (count <= 10000) return "high";
  return "extreme";
}

/**
 * Get color class based on variant count severity.
 *
 * @param count - The variant count
 * @returns Tailwind color classes
 */
export function getVariantCountColor(count: number): string {
  const severity = getVariantCountSeverity(count);
  switch (severity) {
    case "low":
      return "text-emerald-500";
    case "medium":
      return "text-amber-500";
    case "high":
      return "text-orange-500";
    case "extreme":
      return "text-red-500";
  }
}
