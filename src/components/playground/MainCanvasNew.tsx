/**
 * MainCanvasNew - Updated visualization canvas using backend data
 *
 * Features:
 * - Uses new chart components with backend data format
 * - Loading skeletons during execution
 * - Fold distribution chart when splitter is present
 * - Extended color mode options (including fold coloring)
 * - Cross-chart sample highlighting
 * - Step-by-step comparison mode
 *
 * Performance Optimizations:
 * - useMemo for computed values (hasFolds, yValues, gridLayout)
 * - useCallback for event handlers
 * - Skeleton placeholders during loading
 * - Charts render only when visible (effectiveVisibleCharts)
 * - maxSamples prop limits rendered spectra lines
 */

import { useState, useMemo, useCallback, memo } from 'react';
import { FlaskConical, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  SpectraChartNew,
  PCAPlotNew,
  YHistogramNew,
  FoldDistributionChart,
  ChartSkeleton,
  ChartErrorBoundary,
  type ExtendedColorMode,
  type ExtendedColorConfig,
} from './visualizations';
import { SampleDetails } from './SampleDetails';
import { StepComparisonSlider } from './StepComparisonSlider';
import type { PlaygroundResult, FoldsInfo, UnifiedOperator } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

// ============= Types =============

interface MainCanvasNewProps {
  /** Raw spectral data */
  rawData: SpectralData | null;
  /** Backend execution result */
  result: PlaygroundResult | null;
  /** Whether currently loading/processing */
  isLoading?: boolean;
  /** Whether data is being fetched */
  isFetching?: boolean;
  /** Selected sample index (for cross-chart highlighting) */
  selectedSample?: number | null;
  /** Callback when sample is selected */
  onSelectSample?: (index: number | null) => void;
  /** All pipeline operators (for step comparison) */
  operators?: UnifiedOperator[];
  /** Step comparison mode enabled */
  stepComparisonEnabled?: boolean;
  /** Callback when step comparison enabled state changes */
  onStepComparisonEnabledChange?: (enabled: boolean) => void;
  /** Current active step in comparison mode */
  activeStep?: number;
  /** Callback when active step changes */
  onActiveStepChange?: (step: number) => void;
}

type ChartType = 'spectra' | 'histogram' | 'folds' | 'pca';

interface ChartConfig {
  id: ChartType;
  label: string;
  requiresFolds?: boolean;
}

const CHART_CONFIG: ChartConfig[] = [
  { id: 'spectra', label: 'Spectra' },
  { id: 'histogram', label: 'Y Hist' },
  { id: 'folds', label: 'Folds', requiresFolds: true },
  { id: 'pca', label: 'PCA' },
];

// ============= Color Mode Selector =============

interface ColorModeSelectorProps {
  colorConfig: ExtendedColorConfig;
  onChange: (config: ExtendedColorConfig) => void;
  hasFolds: boolean;
}

function ColorModeSelector({ colorConfig, onChange, hasFolds }: ColorModeSelectorProps) {
  return (
    <Select
      value={colorConfig.mode}
      onValueChange={(mode) => onChange({ ...colorConfig, mode: mode as ExtendedColorMode })}
    >
      <SelectTrigger className="h-6 w-24 text-[10px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="target">By Y Value</SelectItem>
        {hasFolds && <SelectItem value="fold">By Fold</SelectItem>}
        <SelectItem value="dataset">By Dataset</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ============= Main Component =============

export function MainCanvasNew({
  rawData,
  result,
  isLoading = false,
  isFetching = false,
  selectedSample: externalSelectedSample,
  onSelectSample: externalOnSelectSample,
  operators = [],
  stepComparisonEnabled = false,
  onStepComparisonEnabledChange,
  activeStep = 0,
  onActiveStepChange,
}: MainCanvasNewProps) {
  // Chart visibility state
  const [visibleCharts, setVisibleCharts] = useState<Set<ChartType>>(
    new Set(['spectra', 'histogram', 'pca'])
  );

  // Local sample selection (if not controlled)
  const [internalSelectedSample, setInternalSelectedSample] = useState<number | null>(null);
  const selectedSample = externalSelectedSample ?? internalSelectedSample;
  const setSelectedSample = externalOnSelectSample ?? setInternalSelectedSample;

  // Color configuration
  const [colorConfig, setColorConfig] = useState<ExtendedColorConfig>({ mode: 'target' });

  // Check if we have folds
  const hasFolds = useMemo(() => {
    return result?.folds && result.folds.n_folds > 0;
  }, [result?.folds]);

  // Toggle folds visibility based on availability
  const effectiveVisibleCharts = useMemo(() => {
    const visible = new Set(visibleCharts);
    if (!hasFolds && visible.has('folds')) {
      visible.delete('folds');
    }
    return visible;
  }, [visibleCharts, hasFolds]);

  // Toggle chart visibility
  const toggleChart = useCallback((chart: ChartType) => {
    setVisibleCharts(prev => {
      const next = new Set(prev);
      if (next.has(chart)) {
        next.delete(chart);
      } else {
        next.add(chart);
      }
      return next;
    });
  }, []);

  // Handle sample selection
  const handleSelectSample = useCallback((index: number | null) => {
    setSelectedSample(index);
  }, [setSelectedSample]);

  // Close sample details
  const handleCloseSampleDetails = useCallback(() => {
    setSelectedSample(null);
  }, [setSelectedSample]);

  // Get Y values
  const yValues = useMemo(() => {
    if (result?.processed?.spectra && rawData?.y) {
      // Use raw Y since playground doesn't process Y
      return rawData.y;
    }
    return rawData?.y ?? [];
  }, [result, rawData]);

  // Compute grid layout
  const visibleCount = effectiveVisibleCharts.size;
  const gridCols = visibleCount <= 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2';
  const gridRows = visibleCount <= 2 ? 'grid-rows-1' : visibleCount <= 4 ? 'grid-rows-2' : 'grid-rows-3';

  // Step comparison handlers
  const handleStepComparisonEnabledChange = useCallback((enabled: boolean) => {
    onStepComparisonEnabledChange?.(enabled);
    if (enabled && activeStep === 0 && operators.filter(op => op.enabled).length > 0) {
      onActiveStepChange?.(operators.filter(op => op.enabled).length);
    }
  }, [onStepComparisonEnabledChange, onActiveStepChange, activeStep, operators]);

  const handleActiveStepChange = useCallback((step: number) => {
    onActiveStepChange?.(step);
  }, [onActiveStepChange]);

  // Empty state - no data loaded
  if (!rawData) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center max-w-lg px-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mx-auto mb-6 shadow-lg">
            <FlaskConical className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">
            NIR Preprocessing Playground
          </h2>
          <p className="text-muted-foreground mb-6 text-base">
            Explore and experiment with preprocessing transformations on your spectral data in real-time.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-card rounded-lg border p-4 text-left">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-blue-500/10 flex items-center justify-center text-blue-500 text-xs font-bold">1</span>
                Load Data
              </h3>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Upload CSV file</li>
                <li>• Select from workspace</li>
                <li>• Use demo data</li>
              </ul>
            </div>
            <div className="bg-card rounded-lg border p-4 text-left">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">2</span>
                Add Operators
              </h3>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Preprocessing (SNV, SG...)</li>
                <li>• Splitters (KFold, SPXY...)</li>
                <li>• Combine & reorder</li>
              </ul>
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 text-xs text-muted-foreground">
            <p className="font-medium mb-2">Keyboard shortcuts:</p>
            <div className="flex justify-center gap-4">
              <span><kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px]">Ctrl+Z</kbd> Undo</span>
              <span><kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px]">Ctrl+Shift+Z</kbd> Redo</span>
              <span><kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px]">←</kbd> <kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px]">→</kbd> Step through</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Determine if we should show skeletons
  const showSkeletons = isLoading && !result;

  // Check if we have operators
  const hasOperators = operators.length > 0;

  // Helper: show "add operators" hint overlay when no operators
  const NoOperatorsHint = () => (
    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10">
      <div className="text-center max-w-sm px-6">
        <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold mb-2">Add your first operator</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Select operators from the palette on the left to start building your preprocessing pipeline.
        </p>
        <div className="text-xs text-muted-foreground">
          <p>Data loaded: <span className="font-medium text-foreground">{rawData?.spectra?.length ?? 0} samples × {rawData?.wavelengths?.length ?? 0} wavelengths</span></p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden relative">
      {/* Sample details panel */}
      {selectedSample !== null && rawData && (
        <SampleDetails
          data={{
            wavelengths: result?.processed?.wavelengths ?? rawData.wavelengths,
            spectra: result?.processed?.spectra ?? rawData.spectra,
            y: yValues,
            sampleIds: rawData.sampleIds,
            metadata: rawData.metadata,
            originalSpectra: result?.original?.spectra ?? rawData.spectra,
            originalY: yValues,
          }}
          sampleIndex={selectedSample}
          onClose={handleCloseSampleDetails}
        />
      )}

      {/* Toolbar */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border bg-card/50"
        role="toolbar"
        aria-label="Chart controls"
      >
        <div className="flex items-center gap-1.5" role="group" aria-label="Chart visibility toggles">
          <span className="text-[10px] text-muted-foreground mr-1">Show:</span>
          {CHART_CONFIG.map(({ id, label, requiresFolds }) => {
            const isVisible = effectiveVisibleCharts.has(id);
            const isDisabled = requiresFolds && !hasFolds;

            return (
              <Button
                key={id}
                variant={isVisible ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-6 text-[10px] gap-1 px-2',
                  !isVisible && 'opacity-50',
                  isDisabled && 'cursor-not-allowed opacity-30'
                )}
                onClick={() => !isDisabled && toggleChart(id)}
                disabled={isDisabled}
                title={isDisabled ? 'Add a splitter to see folds' : undefined}
              >
                {isVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {label}
              </Button>
            );
          })}

          {/* Loading indicator */}
          {isFetching && (
            <Loader2 className="w-3 h-3 animate-spin text-primary ml-2" />
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Step comparison slider (compact) */}
          {operators.length > 0 && onStepComparisonEnabledChange && (
            <StepComparisonSlider
              operators={operators}
              currentStep={activeStep}
              onStepChange={handleActiveStepChange}
              enabled={stepComparisonEnabled}
              onEnabledChange={handleStepComparisonEnabledChange}
              isLoading={isFetching}
              compact
            />
          )}

          <span className="text-[10px] text-muted-foreground">Color:</span>
          <ColorModeSelector
            colorConfig={colorConfig}
            onChange={setColorConfig}
            hasFolds={!!hasFolds}
          />
        </div>
      </div>

      {/* No operators hint overlay */}
      {!hasOperators && <NoOperatorsHint />}

      {/* Charts grid */}
      <div
        className={cn('flex-1 p-3 overflow-auto grid gap-3', gridCols, gridRows)}
        role="region"
        aria-label="Data visualization charts"
      >
        {/* Spectra Chart */}
        {effectiveVisibleCharts.has('spectra') && (
          <div
            className="bg-card rounded-lg border border-border p-3 min-h-[250px]"
            role="img"
            aria-label="Spectra chart showing original and processed spectral data"
          >
            {showSkeletons ? (
              <ChartSkeleton type="spectra" />
            ) : result ? (
              <ChartErrorBoundary chartType="Spectra">
                <SpectraChartNew
                  original={result.original}
                  processed={result.processed}
                  y={yValues}
                  sampleIds={rawData.sampleIds}
                  folds={result.folds}
                  colorConfig={colorConfig}
                  selectedSample={selectedSample}
                  onSelectSample={handleSelectSample}
                  maxSamples={50}
                />
              </ChartErrorBoundary>
            ) : (
              <ChartSkeleton type="spectra" />
            )}
          </div>
        )}

        {/* Y Histogram */}
        {effectiveVisibleCharts.has('histogram') && (
          <div
            className="bg-card rounded-lg border border-border p-3 min-h-[250px]"
            role="img"
            aria-label="Histogram of target Y values distribution"
          >
            {showSkeletons ? (
              <ChartSkeleton type="histogram" />
            ) : yValues.length > 0 ? (
              <ChartErrorBoundary chartType="Histogram">
                <YHistogramNew
                  y={yValues}
                  selectedSample={selectedSample}
                  onSelectSample={handleSelectSample}
                />
              </ChartErrorBoundary>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No Y values available
              </div>
            )}
          </div>
        )}

        {/* Fold Distribution */}
        {effectiveVisibleCharts.has('folds') && hasFolds && (
          <div
            className="bg-card rounded-lg border border-border p-3 min-h-[250px]"
            role="img"
            aria-label="Cross-validation fold distribution chart"
          >
            {showSkeletons ? (
              <ChartSkeleton type="folds" />
            ) : (
              <ChartErrorBoundary chartType="Fold Distribution">
                <FoldDistributionChart
                  folds={result?.folds ?? null}
                />
              </ChartErrorBoundary>
            )}
          </div>
        )}

        {/* PCA Plot */}
        {effectiveVisibleCharts.has('pca') && (
          <div
            className="bg-card rounded-lg border border-border p-3 min-h-[250px]"
            role="img"
            aria-label="PCA scatter plot showing principal component analysis"
          >
            {showSkeletons ? (
              <ChartSkeleton type="pca" />
            ) : result?.pca ? (
              <ChartErrorBoundary chartType="PCA">
                <PCAPlotNew
                  pca={result.pca}
                  y={yValues}
                  folds={result.folds}
                  sampleIds={rawData.sampleIds}
                  colorConfig={colorConfig}
                  selectedSample={selectedSample}
                  onSelectSample={handleSelectSample}
                />
              </ChartErrorBoundary>
            ) : (
              <ChartSkeleton type="pca" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MainCanvasNew;
