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
import { useTranslation } from 'react-i18next';
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

const DK = 'playground.charts.diff.';

const METRIC_OPTIONS: { value: DiffDistanceMetric; labelKey: string; descriptionKey: string }[] = [
  { value: 'euclidean', labelKey: `${DK}metricEuclidean`, descriptionKey: `${DK}metricEuclideanDesc` },
  { value: 'manhattan', labelKey: `${DK}metricManhattan`, descriptionKey: `${DK}metricManhattanDesc` },
  { value: 'cosine', labelKey: `${DK}metricCosine`, descriptionKey: `${DK}metricCosineDesc` },
  { value: 'spectral_angle', labelKey: `${DK}metricSpectralAngle`, descriptionKey: `${DK}metricSpectralAngleDesc` },
  { value: 'correlation', labelKey: `${DK}metricCorrelation`, descriptionKey: `${DK}metricCorrelationDesc` },
  { value: 'mahalanobis', labelKey: `${DK}metricMahalanobis`, descriptionKey: `${DK}metricMahalanobisDesc` },
  { value: 'pca_distance', labelKey: `${DK}metricPca`, descriptionKey: `${DK}metricPcaDesc` },
];

const QUANTILE_OPTIONS: DiffQuantile[] = [50, 75, 90, 95];

const REPETITION_REFERENCE_OPTIONS: { value: RepetitionReference; labelKey: string; descriptionKey: string }[] = [
  { value: 'group_mean', labelKey: `${DK}refGroupMean`, descriptionKey: `${DK}refGroupMeanDesc` },
  { value: 'leave_one_out', labelKey: `${DK}refLeaveOneOut`, descriptionKey: `${DK}refLeaveOneOutDesc` },
  { value: 'first', labelKey: `${DK}refFirst`, descriptionKey: `${DK}refFirstDesc` },
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
  const { t } = useTranslation();
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
  const currentMetricLabel = t(METRIC_OPTIONS.find(m => m.value === diffConfig.metric)?.labelKey ?? `${DK}metricEuclidean`);
  const currentRepetitionRefLabel = t(
    REPETITION_REFERENCE_OPTIONS.find(r => r.value === diffConfig.repetitionReference)?.labelKey ?? `${DK}refMean`,
  );
  const referenceVsFinalLabel = hasReferenceDataset ? t(`${DK}referenceVsFinal`) : t(`${DK}noReferenceDataset`);
  const repetitionVarianceLabel = hasRepetitions ? t(`${DK}repetitionVariance`) : t(`${DK}noRepetitions`);

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
                aria-label={referenceVsFinalLabel}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{referenceVsFinalLabel}</TooltipContent>
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
                aria-label={repetitionVarianceLabel}
              >
                <Repeat2 className="w-3.5 h-3.5" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{repetitionVarianceLabel}</TooltipContent>
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
                  aria-label={t(`${DK}distanceMetricTooltip`, { metric: currentMetricLabel })}
                >
                  <Ruler className="w-3 h-3" />
                  {!compact && currentMetricLabel}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t(`${DK}distanceMetricTooltip`, { metric: currentMetricLabel })}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="bottom" align="start" className="w-52">
            <DropdownMenuLabel className="text-[10px] text-muted-foreground">
              {t(`${DK}distanceMetric`)}
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
                    <span>{t(option.labelKey)}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {t(option.descriptionKey)}
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
                  aria-label={t(`${DK}quantileLines`)}
                >
                  <Percent className="w-3 h-3" />
                  {!compact && activeQuantilesCount > 0 && (
                    <span>{activeQuantilesCount}</span>
                  )}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t(`${DK}quantileLines`)}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="bottom" align="start" className="w-40">
            <DropdownMenuLabel className="text-[10px] text-muted-foreground">
              {t(`${DK}showQuantileLines`)}
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
                    {t(`${DK}refButton`, { ref: currentRepetitionRefLabel })}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t(`${DK}repetitionRefTooltip`)}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="bottom" align="start" className="w-48">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                {t(`${DK}referencePoint`)}
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
                      <span>{t(option.labelKey)}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {t(option.descriptionKey)}
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
              <ToggleGroupItem value="linear" className="h-7 px-2 text-xs" aria-label={t(`${DK}linearScale`)}>
                {t(`${DK}linShort`)}
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{t(`${DK}linearScale`)}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="log" className="h-7 px-2 text-xs" aria-label={t(`${DK}logScale`)}>
                {t(`${DK}logShort`)}
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{t(`${DK}logScale`)}</TooltipContent>
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
                aria-label={t(`${DK}toggleGrid`)}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t(`${DK}toggleGrid`)}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

export default DiffModeControls;
