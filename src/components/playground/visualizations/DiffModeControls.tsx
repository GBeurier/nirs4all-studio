/**
 * DiffModeControls - Toolbar controls specific to difference/comparison mode
 *
 * Phase 7 Implementation: Advanced Difference Visualization
 *
 * Appears in RepetitionsChart toolbar
 * Provides controls for:
 * - Analysis mode (Reference vs Final / Repetition Variance) - icon toggle
 * - Distance metric selection
 * - Quantile reference lines
 * - Repetition reference type - conditional
 * - Scale type (Linear / Log)
 * - Grid toggle
 */

import { useCallback } from 'react';
import {
  ArrowLeftRight,
  Repeat2,
  Ruler,
  Percent,
  Grid3X3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import type {
  DiffAnalysisMode,
  DiffDistanceMetric,
  DiffQuantile,
  DiffScaleType,
  RepetitionReference,
} from '@/lib/playground/spectraConfig';

// ============= Constants =============

const METRIC_OPTIONS: { value: DiffDistanceMetric; label: string; description: string }[] = [
  { value: 'euclidean', label: 'Euclidean', description: 'L2 norm of difference' },
  { value: 'manhattan', label: 'Manhattan', description: 'L1 norm of difference' },
  { value: 'cosine', label: 'Cosine', description: 'Cosine distance (1 - cos similarity)' },
  { value: 'spectral_angle', label: 'Spectral Angle', description: 'Angular distance in spectral space' },
  { value: 'correlation', label: 'Correlation', description: 'Pearson correlation distance' },
  { value: 'mahalanobis', label: 'Mahalanobis', description: 'Covariance-weighted distance' },
  { value: 'pca_distance', label: 'PCA Distance', description: 'Distance in PCA score space' },
];

const QUANTILE_OPTIONS: DiffQuantile[] = [50, 75, 90, 95];

const REPETITION_REFERENCE_OPTIONS: { value: RepetitionReference; label: string; description: string }[] = [
  { value: 'group_mean', label: 'Group Mean', description: 'Distance from group mean' },
  { value: 'leave_one_out', label: 'Leave-One-Out', description: 'Distance from mean of others' },
  { value: 'first', label: 'First', description: 'Distance from first sample' },
];

// ============= Types =============

export interface DiffModeControlsProps {
  /** Config hook result */
  configResult: UseSpectraChartConfigResult;
  /** Callback when any setting changes */
  onInteractionStart?: () => void;
  /** Compact mode for smaller containers */
  compact?: boolean;
  /** Whether reference dataset mode is active (affects dataset source visibility) */
  hasReferenceDataset?: boolean;
  /** Whether repetitions are available in the dataset */
  hasRepetitions?: boolean;
  /** Whether to show grid */
  showGrid?: boolean;
  /** Callback when grid toggle changes */
  onGridToggle?: () => void;
}

// ============= Component =============

export function DiffModeControls({
  configResult,
  onInteractionStart,
  compact = false,
  hasReferenceDataset = false,
  hasRepetitions = false,
  showGrid = true,
  onGridToggle,
}: DiffModeControlsProps) {
  const { config } = configResult;
  const diffConfig = config.diffConfig;

  // ============= Handlers =============

  const handleAnalysisModeChange = useCallback((value: string) => {
    if (!value) return;
    onInteractionStart?.();
    configResult.setDiffAnalysisMode(value as DiffAnalysisMode);
  }, [configResult, onInteractionStart]);

  const handleMetricChange = useCallback((value: string) => {
    onInteractionStart?.();
    configResult.setDiffMetric(value as DiffDistanceMetric);
  }, [configResult, onInteractionStart]);

  const handleQuantileToggle = useCallback((quantile: DiffQuantile) => {
    onInteractionStart?.();
    configResult.toggleDiffQuantile(quantile);
  }, [configResult, onInteractionStart]);

  const handleRepetitionReferenceChange = useCallback((value: string) => {
    onInteractionStart?.();
    configResult.setDiffRepetitionReference(value as RepetitionReference);
  }, [configResult, onInteractionStart]);

  const handleScaleTypeChange = useCallback((value: string) => {
    if (!value) return;
    onInteractionStart?.();
    configResult.setDiffScaleType(value as DiffScaleType);
  }, [configResult, onInteractionStart]);

  // ============= Computed Values =============

  const isRepetitionMode = diffConfig.analysisMode === 'repetition_variance';
  const showRepetitionReference = isRepetitionMode && hasRepetitions;
  const activeQuantilesCount = diffConfig.quantiles.length;
  const currentMetricLabel = METRIC_OPTIONS.find(m => m.value === diffConfig.metric)?.label ?? 'Euclidean';

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        {/* Analysis Mode Toggle - Icon only */}
        <ToggleGroup
          type="single"
          value={diffConfig.analysisMode}
          onValueChange={handleAnalysisModeChange}
          className="h-7"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value="reference_vs_final"
                className="h-7 w-7 p-0"
                disabled={!hasReferenceDataset}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>
              {hasReferenceDataset
                ? 'Reference vs Final: Compare original and processed spectra'
                : 'No reference dataset available'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value="repetition_variance"
                className={cn(
                  'h-7 w-7 p-0',
                  !hasRepetitions && 'opacity-50'
                )}
                disabled={!hasRepetitions}
              >
                <Repeat2 className="w-3.5 h-3.5" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>
              {hasRepetitions
                ? 'Repetition Variance: Analyze variance within repetition groups'
                : 'No repetitions available in dataset'}
            </TooltipContent>
          </Tooltip>
        </ToggleGroup>

        {/* Metric Dropdown */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-7 px-2 text-xs gap-1',
                    compact && 'px-1.5'
                  )}
                >
                  <Ruler className="w-3 h-3" />
                  {!compact && currentMetricLabel}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Distance metric: {currentMetricLabel}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="bottom" align="start" className="w-52">
            <DropdownMenuLabel className="text-[10px] text-muted-foreground">
              Distance Metric
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={diffConfig.metric}
              onValueChange={handleMetricChange}
            >
              {METRIC_OPTIONS.map(option => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  className="text-xs"
                >
                  <div className="flex flex-col">
                    <span>{option.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {option.description}
                    </span>
                  </div>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Quantiles Dropdown */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={activeQuantilesCount > 0 ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                >
                  <Percent className="w-3 h-3" />
                  {!compact && activeQuantilesCount > 0 && (
                    <span>{activeQuantilesCount}</span>
                  )}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Quantile reference lines</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="bottom" align="start" className="w-40">
            <DropdownMenuLabel className="text-[10px] text-muted-foreground">
              Show Quantile Lines
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {QUANTILE_OPTIONS.map(quantile => (
              <DropdownMenuCheckboxItem
                key={quantile}
                checked={diffConfig.quantiles.includes(quantile)}
                onCheckedChange={() => handleQuantileToggle(quantile)}
                className="text-xs"
              >
                P{quantile}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Repetition Reference Dropdown (conditional) */}
        {showRepetitionReference && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                  >
                    Ref: {REPETITION_REFERENCE_OPTIONS.find(
                      r => r.value === diffConfig.repetitionReference
                    )?.label ?? 'Mean'}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Reference point for repetition variance</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="bottom" align="start" className="w-48">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                Reference Point
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={diffConfig.repetitionReference}
                onValueChange={handleRepetitionReferenceChange}
              >
                {REPETITION_REFERENCE_OPTIONS.map(option => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="text-xs"
                  >
                    <div className="flex flex-col">
                      <span>{option.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {option.description}
                      </span>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Scale Toggle */}
        <ToggleGroup
          type="single"
          value={diffConfig.scaleType}
          onValueChange={handleScaleTypeChange}
          className="h-7"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="linear" className="h-7 px-2 text-xs">
                Lin
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>Linear scale</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="log" className="h-7 px-2 text-xs">
                Log
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>Logarithmic scale</TooltipContent>
          </Tooltip>
        </ToggleGroup>

        {/* Grid Toggle */}
        {onGridToggle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showGrid ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 w-7 p-0"
                onClick={onGridToggle}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle grid</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

export default DiffModeControls;
