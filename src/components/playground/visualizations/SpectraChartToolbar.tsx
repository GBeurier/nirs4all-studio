/**
 * SpectraChartToolbar - Minimal toolbar for SpectraChart
 *
 * Phase 3 Implementation: Clean UI
 *
 * Minimal controls:
 * - Title and sample count
 * - Settings popup button (all controls in popup)
 * - Export button
 */

import { useState, useMemo } from 'react';
import {
  Download,
  Layers,
  RefreshCw,
  SlidersHorizontal,
  ZoomIn,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SpectraSettingsPopup } from './SpectraSettingsPopup';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import type { SamplingResult } from '@/lib/playground/sampling';
import type { UnifiedOperator } from '@/types/playground';

// ============= Types =============

export interface SpectraChartToolbarProps {
  /** Config hook result */
  configResult: UseSpectraChartConfigResult;
  /** Current sampling result */
  samplingResult?: SamplingResult;
  /** Total number of samples in dataset */
  totalSamples: number;
  /** Displayed sample count */
  displayedSamples: number;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Whether brush zoom is active */
  brushActive?: boolean;
  /** Reset brush callback */
  onResetBrush?: () => void;
  /** Export callback */
  onExport?: () => void;
  /** Callback when any setting changes (for triggering redraw) */
  onInteractionStart?: () => void;
  /** Compact mode for smaller containers */
  compact?: boolean;
  /** Available operators for reference step selection */
  operators?: UnifiedOperator[];
  /** Available metadata columns for coloring */
  metadataColumns?: string[];
  /** Wavelength range for focus controls */
  wavelengthRange?: [number, number];
}

// ============= Main Component =============

export function SpectraChartToolbar({
  configResult,
  samplingResult,
  totalSamples,
  displayedSamples,
  isLoading,
  brushActive,
  onResetBrush,
  onExport,
  onInteractionStart,
  compact = false,
  operators,
  metadataColumns,
  wavelengthRange,
}: SpectraChartToolbarProps) {
  const { config } = configResult;

  // Settings popup state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Compute sample count description
  const sampleDescription = useMemo(() => {
    if (samplingResult && samplingResult.wasApplied) {
      return `${displayedSamples}/${totalSamples}`;
    }
    return `${totalSamples}`;
  }, [samplingResult, displayedSamples, totalSamples]);

  // Count modified settings for badge
  const modifiedCount = useMemo(() => {
    let count = 0;
    if (config.viewMode !== 'processed') count++;
    if (config.aggregation.mode !== 'none') count++;
    if (config.displayMode !== 'individual') count++;
    if (config.colorConfig.mode !== 'sample') count++;
    if (config.sampling.sampleCount !== 100) count++;
    if (config.wavelengthFocus.range) count++;
    return count;
  }, [config]);

  return (
    <TooltipProvider>
      <div className={cn(
        'flex items-center justify-between gap-2',
        compact ? 'mb-1.5' : 'mb-2'
      )}>
        {/* Left side - Title and sample count */}
        <div className="flex items-center gap-2">
          <h3 className={cn(
            'font-semibold text-foreground flex items-center gap-2',
            compact ? 'text-xs' : 'text-sm'
          )}>
            <Layers className={cn('text-primary', compact ? 'w-3 h-3' : 'w-4 h-4')} />
            Spectra
          </h3>
          <Badge variant="outline" className={cn('font-mono', compact ? 'text-[9px] h-4 px-1' : 'text-[10px] h-5 px-1.5')}>
            {sampleDescription}
          </Badge>
          {isLoading && (
            <RefreshCw className={cn('animate-spin text-primary', compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
          )}
        </div>

        {/* Right side - Minimal controls */}
        <div className="flex items-center gap-1">
          {/* Reset zoom button (only when active) */}
          {brushActive && onResetBrush && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={onResetBrush}
                >
                  <ZoomIn className="w-3 h-3" />
                  Reset
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset wavelength zoom</TooltipContent>
            </Tooltip>
          )}

          {/* Settings button with badge */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={settingsOpen ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 gap-1"
                onClick={() => setSettingsOpen(true)}
              >
                <SlidersHorizontal className="w-3 h-3" />
                {modifiedCount > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[9px] ml-0.5">
                    {modifiedCount}
                  </Badge>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Chart settings</TooltipContent>
          </Tooltip>

          {/* Export button */}
          {onExport && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={onExport}
                >
                  <Download className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export chart</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Settings popup (all controls consolidated here) */}
      <SpectraSettingsPopup
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        configResult={configResult}
        operators={operators}
        metadataColumns={metadataColumns}
        wavelengthRange={wavelengthRange}
        totalSamples={totalSamples}
        onInteractionStart={onInteractionStart}
      />
    </TooltipProvider>
  );
}

export default SpectraChartToolbar;
