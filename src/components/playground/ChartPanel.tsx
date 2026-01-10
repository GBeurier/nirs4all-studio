/**
 * ChartPanel - Reusable wrapper component for chart containers
 *
 * Phase 2 Enhancement: Layout & View Management
 *
 * Features:
 * - Header with title, icon, and control buttons
 * - Max/Min/Hide buttons for view management
 * - Footer with sample count and selection stats
 * - Loading overlay with spinner
 * - Error boundary integration
 * - Ref forwarding for export functionality
 * - CSS transitions for smooth state changes
 * - Double-click header to maximize/restore
 * - Minimized state (collapsed to header only)
 */

import { forwardRef, useCallback, type ReactNode, type MouseEvent } from 'react';
import {
  Loader2,
  Maximize2,
  Minimize2,
  X,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  Activity,
  BarChart3,
  GitBranch,
  ScatterChart,
  Repeat,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChartErrorBoundary } from './visualizations/ChartErrorBoundary';
import type { ChartType, ViewState } from '@/context/PlaygroundViewContext';

// Re-export for convenience
export { ChartErrorBoundary };

// ============= Chart Icons =============

const CHART_ICONS: Record<ChartType, typeof Activity> = {
  spectra: Activity,
  histogram: BarChart3,
  folds: GitBranch,
  pca: ScatterChart,
  repetitions: Repeat,
};

const CHART_LABELS: Record<ChartType, string> = {
  spectra: 'Spectra',
  histogram: 'Y Distribution',
  folds: 'Fold Distribution',
  pca: 'Dimension Reduction',
  repetitions: 'Repetitions',
};

// ============= Types =============

export interface ChartPanelProps {
  /** Chart content */
  children: ReactNode;
  /** Chart type identifier */
  chartType: ChartType;
  /** Whether to show loading overlay */
  isLoading?: boolean;
  /** Aria label for accessibility */
  ariaLabel?: string;
  /** Additional className */
  className?: string;
  /** Minimum height */
  minHeight?: string;

  // View state management
  /** Current view state */
  viewState?: ViewState;
  /** Whether this chart is maximized */
  isMaximized?: boolean;
  /** Callback when maximize is requested */
  onMaximize?: () => void;
  /** Callback when minimize is requested */
  onMinimize?: () => void;
  /** Callback when restore is requested (from minimized/maximized) */
  onRestore?: () => void;
  /** Callback when hide is requested */
  onHide?: () => void;

  // Footer stats
  /** Total sample count */
  sampleCount?: number;
  /** Selected sample count */
  selectedCount?: number;
  /** Pinned sample count */
  pinnedCount?: number;

  // Custom header content
  /** Custom header content (rendered between title and buttons) */
  headerContent?: ReactNode;
  /** Custom menu items for dropdown */
  menuItems?: ReactNode;

  // Phase 10: Resize capability
  /** Enable CSS resize (experimental - works within grid cell) */
  resizable?: boolean;
}

// ============= Sub-Components =============

interface ChartLoadingOverlayProps {
  visible: boolean;
}

export function ChartLoadingOverlay({ visible }: ChartLoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-20 pointer-events-none">
      <Loader2 className="w-5 h-5 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">Updating chart</span>
    </div>
  );
}

interface ChartHeaderProps {
  chartType: ChartType;
  isMaximized: boolean;
  isMinimized: boolean;
  onMaximize?: () => void;
  onMinimize?: () => void;
  onRestore?: () => void;
  onHide?: () => void;
  onDoubleClick: () => void;
  headerContent?: ReactNode;
  menuItems?: ReactNode;
}

function ChartHeader({
  chartType,
  isMaximized,
  isMinimized,
  onMaximize,
  onMinimize,
  onRestore,
  onHide,
  onDoubleClick,
  headerContent,
  menuItems,
}: ChartHeaderProps) {
  const Icon = CHART_ICONS[chartType];
  const label = CHART_LABELS[chartType];

  const handleDoubleClick = useCallback((e: MouseEvent) => {
    e.preventDefault();
    onDoubleClick();
  }, [onDoubleClick]);

  // Only render header for minimized charts (where we need to show the title)
  // For visible/maximized charts, content components render their own headers
  if (!isMinimized) {
    return null;
  }

  return (
    <div
      className="flex items-center gap-2 pb-2 border-b border-border/50 select-none cursor-default"
      onDoubleClick={handleDoubleClick}
    >
      {/* Icon and Title - only shown when minimized */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground truncate">{label}</span>
      </div>

      {/* Custom header content */}
      {headerContent && (
        <div className="flex items-center gap-1">
          {headerContent}
        </div>
      )}

      {/* Control buttons */}
      <div className="flex items-center gap-0.5">
        {/* Restore from minimized */}
        {isMinimized && onRestore && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore();
                }}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Restore</TooltipContent>
          </Tooltip>
        )}

        {/* Menu dropdown (if custom items provided) */}
        {menuItems && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menuItems}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Hide button */}
        {onHide && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onHide();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Hide</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

interface ChartFooterProps {
  sampleCount?: number;
  selectedCount?: number;
  pinnedCount?: number;
}

function ChartFooter({ sampleCount, selectedCount, pinnedCount }: ChartFooterProps) {
  const hasStats = sampleCount !== undefined || selectedCount !== undefined || pinnedCount !== undefined;
  if (!hasStats) return null;

  const stats: string[] = [];
  if (sampleCount !== undefined) {
    stats.push(`${sampleCount} samples`);
  }
  if (selectedCount !== undefined && selectedCount > 0) {
    stats.push(`${selectedCount} selected`);
  }
  if (pinnedCount !== undefined && pinnedCount > 0) {
    stats.push(`${pinnedCount} pinned`);
  }

  return (
    <div className="pt-2 border-t border-border/50 mt-auto">
      <div className="text-xs text-muted-foreground">
        {stats.join(' | ')}
      </div>
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
      viewState = 'visible',
      isMaximized = false,
      onMaximize,
      onMinimize,
      onRestore,
      onHide,
      sampleCount,
      selectedCount,
      pinnedCount,
      headerContent,
      menuItems,
      resizable = false,
    },
    ref
  ) {
    const isMinimized = viewState === 'minimized';
    const isHidden = viewState === 'hidden';

    // Handle double-click to toggle maximize
    // Note: Hook must be called before early return
    const handleHeaderDoubleClick = useCallback(() => {
      if (isMinimized) {
        onRestore?.();
      } else if (isMaximized) {
        onRestore?.();
      } else {
        onMaximize?.();
      }
    }, [isMinimized, isMaximized, onRestore, onMaximize]);

    // Don't render if hidden (early return after hooks)
    if (isHidden) return null;

    return (
      <div
        ref={ref}
        className={cn(
          'bg-card rounded-lg border border-border relative flex flex-col',
          'transition-all duration-200 ease-in-out',
          isMaximized && 'col-span-full row-span-full z-10',
          isMinimized && 'min-h-0',
          // Phase 10: CSS resize capability (experimental)
          resizable && !isMinimized && !isMaximized && 'resize overflow-auto',
          className
        )}
        style={{
          minHeight: isMinimized ? 'auto' : minHeight,
          // CSS resize needs explicit min dimensions
          ...(resizable && !isMinimized && !isMaximized ? {
            minWidth: '200px',
            maxWidth: '100%',
            maxHeight: '100%',
          } : {}),
        }}
        role="img"
        aria-label={ariaLabel ?? `${CHART_LABELS[chartType]} visualization`}
        data-chart-type={chartType}
        data-view-state={viewState}
      >
        {/* Header - only shown when minimized */}
        {isMinimized && (
          <div className="p-3 pb-0">
            <ChartHeader
              chartType={chartType}
              isMaximized={isMaximized}
              isMinimized={isMinimized}
              onMaximize={onMaximize}
              onMinimize={onMinimize}
              onRestore={onRestore}
              onHide={onHide}
              onDoubleClick={handleHeaderDoubleClick}
              headerContent={headerContent}
              menuItems={menuItems}
            />
          </div>
        )}

        {/* Content - hidden when minimized */}
        {!isMinimized && (
          <div className="flex-1 p-3 flex flex-col min-h-0 relative">
            <ChartLoadingOverlay visible={isLoading} />
            <ChartErrorBoundary chartType={CHART_LABELS[chartType]}>
              <div className="flex-1 min-h-0">
                {children}
              </div>
            </ChartErrorBoundary>
          </div>
        )}

        {/* Footer - hidden when minimized */}
        {!isMinimized && (sampleCount !== undefined || selectedCount !== undefined || pinnedCount !== undefined) && (
          <div className="px-3 pb-2">
            <ChartFooter
              sampleCount={sampleCount}
              selectedCount={selectedCount}
              pinnedCount={pinnedCount}
            />
          </div>
        )}
      </div>
    );
  }
);

export default ChartPanel;
