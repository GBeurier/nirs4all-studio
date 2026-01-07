/**
 * ChartPanel - Reusable wrapper component for chart containers
 *
 * Phase 1 Refactoring: Component Modularization
 *
 * Features:
 * - Consistent styling for all chart containers
 * - Loading overlay with spinner
 * - Error boundary integration
 * - Ref forwarding for export functionality
 * - Accessibility attributes
 */

import { forwardRef, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChartErrorBoundary } from './visualizations/ChartErrorBoundary';

// Re-export for convenience
export { ChartErrorBoundary };

// ============= Types =============

export interface ChartPanelProps {
  /** Chart content */
  children: ReactNode;
  /** Chart type name for error boundary */
  chartType: string;
  /** Whether to show loading overlay */
  isLoading?: boolean;
  /** Aria label for accessibility */
  ariaLabel?: string;
  /** Additional className */
  className?: string;
  /** Minimum height */
  minHeight?: string;
  /** Whether chart is visible */
  visible?: boolean;
}

// ============= Sub-Components =============

interface ChartLoadingOverlayProps {
  visible: boolean;
}

export function ChartLoadingOverlay({ visible }: ChartLoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] flex items-center justify-center z-20 pointer-events-none">
      <Loader2 className="w-5 h-5 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">Updating chart</span>
    </div>
  );
}

// ============= Main Component =============

export const ChartPanel = forwardRef<HTMLDivElement, ChartPanelProps>(
  function ChartPanel(
    {
      children,
      chartType,
      isLoading = false,
      ariaLabel,
      className,
      minHeight = '250px',
      visible = true,
    },
    ref
  ) {
    if (!visible) return null;

    return (
      <div
        ref={ref}
        className={cn(
          'bg-card rounded-lg border border-border p-3 relative',
          className
        )}
        style={{ minHeight }}
        role="img"
        aria-label={ariaLabel ?? `${chartType} visualization`}
      >
        <ChartLoadingOverlay visible={isLoading} />
        <ChartErrorBoundary chartType={chartType}>
          {children}
        </ChartErrorBoundary>
      </div>
    );
  }
);

export default ChartPanel;
