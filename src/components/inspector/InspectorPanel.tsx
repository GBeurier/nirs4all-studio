/**
 * InspectorPanel — Reusable panel wrapper for Inspector visualizations.
 *
 * Adapted from ChartPanel.tsx with InspectorPanelType instead of ChartType.
 * Features: header with title/icon, max/min/hide buttons, content with error
 * boundary, footer with stats.
 */

import { forwardRef, useCallback, type ReactNode, type MouseEvent } from 'react';
import {
  Loader2,
  Maximize2,
  Minimize2,
  CircleHelp,
  X,
  ChevronUp,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { InspectorPanelType, InspectorViewState } from '@/types/inspector';
import { PANEL_MAP } from '@/lib/inspector/chartRegistry';
import { useInspectorExport } from '@/hooks/useInspectorExport';

// ============= Types =============

export interface InspectorPanelProps {
  children: ReactNode;
  panelType: InspectorPanelType;
  isLoading?: boolean;
  className?: string;
  minHeight?: string;

  // View state
  viewState?: InspectorViewState;
  isMaximized?: boolean;
  onMaximize?: () => void;
  onMinimize?: () => void;
  onRestore?: () => void;
  onHide?: () => void;

  // Footer stats
  itemCount?: number;
  selectedCount?: number;

  // Custom header content
  headerContent?: ReactNode;
}

// ============= Sub-Components =============

function PanelLoadingOverlay({ visible }: { visible: boolean }) {
  return (
    <div
      className={cn(
        'absolute inset-0 bg-background/80 flex items-center justify-center z-20 pointer-events-none',
        'transition-opacity duration-150',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
      )}
    >
      <Loader2 className="w-5 h-5 animate-spin text-primary" />
    </div>
  );
}

function PanelHeader({
  panelType,
  isMaximized,
  isMinimized,
  onMaximize,
  onMinimize,
  onRestore,
  onHide,
  onExportPng,
  onDoubleClick,
  headerContent,
}: {
  panelType: InspectorPanelType;
  isMaximized: boolean;
  isMinimized: boolean;
  onMaximize?: () => void;
  onMinimize?: () => void;
  onRestore?: () => void;
  onHide?: () => void;
  onExportPng?: () => void;
  onDoubleClick: () => void;
  headerContent?: ReactNode;
}) {
  const def = PANEL_MAP.get(panelType);
  const Icon = def?.icon;
  const label = def?.name ?? panelType;
  const help = def?.help;

  const handleDoubleClick = useCallback((e: MouseEvent) => {
    e.preventDefault();
    onDoubleClick();
  }, [onDoubleClick]);

  return (
    <div
      className="flex items-center gap-2 pb-2 border-b border-border/50 select-none cursor-default"
      onDoubleClick={handleDoubleClick}
    >
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {Icon && <Icon className="w-4 h-4 text-muted-foreground shrink-0" />}
        <span className="text-sm font-medium text-foreground truncate">{label}</span>
        {help && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Help for ${label}`}
              >
                <CircleHelp className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs leading-5">
              {help}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {headerContent && <div className="flex items-center gap-1">{headerContent}</div>}

      <div className="flex items-center gap-0.5">
        {!isMinimized && onExportPng && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onExportPng(); }}>
                <Download className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Export PNG</TooltipContent>
          </Tooltip>
        )}

        {isMinimized && onRestore && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onRestore(); }}>
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Restore</TooltipContent>
          </Tooltip>
        )}

        {!isMinimized && !isMaximized && onMinimize && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onMinimize(); }}>
                <Minimize2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Minimize</TooltipContent>
          </Tooltip>
        )}

        {!isMaximized && onMaximize && !isMinimized && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onMaximize(); }}>
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Maximize</TooltipContent>
          </Tooltip>
        )}

        {isMaximized && onRestore && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onRestore(); }}>
                <Minimize2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Restore</TooltipContent>
          </Tooltip>
        )}

        {onHide && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); onHide(); }}>
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

function PanelFooter({ itemCount, selectedCount }: { itemCount?: number; selectedCount?: number }) {
  if (itemCount === undefined && selectedCount === undefined) return null;

  return (
    <div className="mt-auto flex items-center gap-3 border-t border-border/40 pt-1.5">
      {itemCount !== undefined && (
        <span className="tabular-nums text-[11px] text-muted-foreground">{itemCount} chains</span>
      )}
      {selectedCount !== undefined && selectedCount > 0 && (
        <span className="tabular-nums text-[11px] font-medium text-primary">{selectedCount} selected</span>
      )}
    </div>
  );
}

// ============= Main Component =============

export const InspectorPanel = forwardRef<HTMLDivElement, InspectorPanelProps>(
  function InspectorPanel(
    {
      children,
      panelType,
      isLoading = false,
      className,
      minHeight = '300px',
      viewState = 'visible',
      isMaximized = false,
      onMaximize,
      onMinimize,
      onRestore,
      onHide,
      itemCount,
      selectedCount,
      headerContent,
    },
    ref,
  ) {
    const { exportPanelAsPng } = useInspectorExport();
    const isMinimized = viewState === 'minimized';
    const isHidden = viewState === 'hidden';

    const handleExportPng = useCallback(() => {
      exportPanelAsPng(panelType);
    }, [exportPanelAsPng, panelType]);

    const handleHeaderDoubleClick = useCallback(() => {
      if (isMinimized) onRestore?.();
      else if (isMaximized) onRestore?.();
      else onMaximize?.();
    }, [isMinimized, isMaximized, onRestore, onMaximize]);

    if (isHidden) return null;

    return (
      <TooltipProvider delayDuration={200}>
        <div
          ref={ref}
          className={cn(
            'bg-card rounded-lg border border-border/70 shadow-sm relative flex flex-col select-none',
            'transition-all duration-200 ease-in-out',
            isMaximized && 'col-span-full row-span-full z-10',
            isMinimized && 'min-h-0',
            className,
          )}
          style={{ minHeight: isMinimized ? 'auto' : minHeight }}
          data-panel-type={panelType}
          data-view-state={viewState}
        >
          {/* Header — always shown */}
          <div className="p-3 pb-0">
            <PanelHeader
              panelType={panelType}
              isMaximized={isMaximized}
              isMinimized={isMinimized}
              onMaximize={onMaximize}
              onMinimize={onMinimize}
              onRestore={onRestore}
              onHide={onHide}
              onExportPng={handleExportPng}
              onDoubleClick={handleHeaderDoubleClick}
              headerContent={headerContent}
            />
          </div>

          {/* Content */}
          {!isMinimized && (
            <div className="flex-1 p-3 flex flex-col min-h-0 relative animate-in fade-in duration-150">
              <PanelLoadingOverlay visible={isLoading} />
              <div className="flex-1 min-h-0">{children}</div>
            </div>
          )}

          {/* Footer */}
          {!isMinimized && (itemCount !== undefined || selectedCount !== undefined) && (
            <div className="px-3 pb-2">
              <PanelFooter itemCount={itemCount} selectedCount={selectedCount} />
            </div>
          )}
        </div>
      </TooltipProvider>
    );
  },
);
