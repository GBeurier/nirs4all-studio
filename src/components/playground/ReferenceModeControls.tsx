/**
 * ReferenceModeControls - Controls for reference mode (step vs dataset comparison)
 *
 * Phase 6: Dataset Reference Mode
 *
 * Features:
 * - Toggle between Step and Dataset reference modes
 * - Dataset picker dropdown when in dataset mode
 * - Compatibility warnings display
 * - Alignment mode selector
 */

import { useState, useEffect, memo, useMemo } from 'react';
import {
  GitCompare,
  Database,
  Layers,
  AlertTriangle,
  Check,
  Loader2,
  X,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { getWorkspace, type DatasetInfo } from '@/api/client';
import { useReferenceDatasetOptional, type ReferenceMode, type AlignmentMode } from '@/context/ReferenceDatasetContext';

interface ReferenceModeControlsProps {
  /** Whether step comparison is enabled (passed from parent) */
  stepComparisonEnabled?: boolean;
  /** Callback when step comparison should be disabled (when switching to dataset mode) */
  onDisableStepComparison?: () => void;
  /** Current dataset ID to exclude from reference picker */
  currentDatasetId?: string;
  /** Compact mode for smaller toolbar layout */
  compact?: boolean;
  /** Called when interaction starts (for debouncing) */
  onInteractionStart?: () => void;
}

export const ReferenceModeControls = memo(function ReferenceModeControls({
  stepComparisonEnabled,
  onDisableStepComparison,
  currentDatasetId,
  compact = false,
  onInteractionStart,
}: ReferenceModeControlsProps) {
  const referenceCtx = useReferenceDatasetOptional();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);

  // Don't render if context not available
  if (!referenceCtx) {
    return null;
  }

  const {
    mode,
    setReferenceMode,
    referenceInfo,
    referenceData,
    isLoading,
    error,
    compatibility,
    alignmentMode,
    setAlignmentMode,
    loadReferenceDataset,
    clearReferenceDataset,
    isReferenceActive,
  } = referenceCtx;

  // Load datasets when picker opens
  useEffect(() => {
    if (pickerOpen && datasets.length === 0 && !datasetsLoading) {
      setDatasetsLoading(true);
      getWorkspace()
        .then(response => {
          setDatasets(response.datasets || []);
          setDatasetsLoading(false);
        })
        .catch(err => {
          setDatasetsError(err.message || 'Failed to load datasets');
          setDatasetsLoading(false);
        });
    }
  }, [pickerOpen, datasets.length, datasetsLoading]);

  // Filter out current dataset from picker
  const availableDatasets = useMemo(() => {
    if (!currentDatasetId) return datasets;
    return datasets.filter(d => d.id !== currentDatasetId);
  }, [datasets, currentDatasetId]);

  // Handle mode change
  const handleModeChange = (newMode: ReferenceMode) => {
    onInteractionStart?.();
    setReferenceMode(newMode);

    // Disable step comparison when switching to dataset mode
    if (newMode === 'dataset' && stepComparisonEnabled) {
      onDisableStepComparison?.();
    }
  };

  // Handle dataset selection
  const handleDatasetSelect = (dataset: DatasetInfo) => {
    onInteractionStart?.();
    loadReferenceDataset(dataset.id, dataset.name);
    setPickerOpen(false);
  };

  // Handle clear reference
  const handleClearReference = () => {
    onInteractionStart?.();
    clearReferenceDataset();
  };

  // Compact badge rendering
  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        {/* Mode toggle */}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={mode === 'dataset' ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-6 px-2 text-[10px] gap-1',
                  mode === 'dataset' && 'bg-primary/10 text-primary'
                )}
                onClick={() => handleModeChange(mode === 'step' ? 'dataset' : 'step')}
              >
                <GitCompare className="w-3 h-3" />
                {mode === 'dataset' ? 'Dataset' : 'Step'}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs">
                {mode === 'step'
                  ? 'Step mode: Compare raw vs processed data using the step slider'
                  : 'Dataset mode: Compare against another dataset'}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Dataset picker (when in dataset mode) */}
        {mode === 'dataset' && (
          <>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-6 px-2 text-[10px] gap-1 min-w-[100px] justify-between',
                    isLoading && 'opacity-50'
                  )}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Loading...
                    </>
                  ) : referenceInfo ? (
                    <>
                      <Database className="w-3 h-3 shrink-0" />
                      <span className="truncate max-w-[80px]">{referenceInfo.datasetName}</span>
                    </>
                  ) : (
                    <>
                      <Database className="w-3 h-3" />
                      Select...
                    </>
                  )}
                  <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <div className="p-2 border-b">
                  <span className="text-xs font-medium text-muted-foreground">
                    Select Reference Dataset
                  </span>
                </div>
                {datasetsLoading ? (
                  <div className="p-4 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : datasetsError ? (
                  <div className="p-3 text-xs text-destructive">
                    {datasetsError}
                  </div>
                ) : availableDatasets.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground text-center">
                    No other datasets available
                  </div>
                ) : (
                  <ScrollArea className="max-h-[200px]">
                    <div className="p-1" role="listbox" aria-label="Available datasets">
                      {availableDatasets.map(dataset => (
                        <button
                          key={dataset.id}
                          role="option"
                          aria-selected={referenceInfo?.datasetId === dataset.id}
                          onClick={() => handleDatasetSelect(dataset)}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-md text-xs',
                            'hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-primary',
                            referenceInfo?.datasetId === dataset.id && 'bg-accent'
                          )}
                        >
                          <div className="font-medium truncate">{dataset.name}</div>
                          {(dataset.samples || dataset.features) && (
                            <div className="text-[10px] text-muted-foreground">
                              {dataset.samples && `${dataset.samples} samples`}
                              {dataset.samples && dataset.features && ' · '}
                              {dataset.features && `${dataset.features} features`}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </PopoverContent>
            </Popover>

            {/* Clear button when reference is loaded */}
            {referenceData && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={handleClearReference}
                      aria-label="Clear reference dataset"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear reference dataset</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Compatibility warning badge */}
            {compatibility && !compatibility.compatible && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Incompatible
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <p className="text-xs">{compatibility.warnings.join('. ')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Compatibility warnings badge */}
            {compatibility && compatibility.compatible && compatibility.warnings.length > 0 && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-amber-600 border-amber-300">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      {compatibility.warnings.length}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <ul className="text-xs space-y-1">
                      {compatibility.warnings.map((w, i) => (
                        <li key={i}>• {w}</li>
                      ))}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Success indicator */}
            {isReferenceActive && compatibility?.compatible && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-emerald-600 border-emerald-300">
                <Check className="w-3 h-3 mr-1" />
                Active
              </Badge>
            )}

            {/* Error badge */}
            {error && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                      Error
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <p className="text-xs">{error}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Alignment mode selector (when reference is active) */}
            {isReferenceActive && (
              <Select
                value={alignmentMode}
                onValueChange={(v) => {
                  onInteractionStart?.();
                  setAlignmentMode(v as AlignmentMode);
                }}
              >
                <SelectTrigger className="h-6 w-24 text-[10px]">
                  <Layers className="w-3 h-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="index">By Index</SelectItem>
                  <SelectItem value="id_column">By Sample ID</SelectItem>
                  <SelectItem value="none">No Alignment</SelectItem>
                </SelectContent>
              </Select>
            )}
          </>
        )}
      </div>
    );
  }

  // Full-size rendering (non-compact)
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Reference:</span>

      {/* Mode selector */}
      <Select value={mode} onValueChange={(v) => handleModeChange(v as ReferenceMode)}>
        <SelectTrigger className="h-7 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="step">
            <div className="flex items-center gap-2">
              <Layers className="w-3 h-3" />
              Step
            </div>
          </SelectItem>
          <SelectItem value="dataset">
            <div className="flex items-center gap-2">
              <Database className="w-3 h-3" />
              Dataset
            </div>
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Dataset picker and other controls when in dataset mode */}
      {mode === 'dataset' && (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-3 text-xs gap-2 min-w-[140px] justify-between"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading...
                </>
              ) : referenceInfo ? (
                <>
                  <Database className="w-3 h-3" />
                  <span className="truncate">{referenceInfo.datasetName}</span>
                </>
              ) : (
                <>
                  <Database className="w-3 h-3" />
                  Select dataset...
                </>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <div className="p-3 border-b">
              <h4 className="text-sm font-medium">Select Reference Dataset</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Choose a dataset to compare against the primary dataset
              </p>
            </div>
            {datasetsLoading ? (
              <div className="p-6 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : datasetsError ? (
              <div className="p-4 text-sm text-destructive">{datasetsError}</div>
            ) : availableDatasets.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                No other datasets available in workspace
              </div>
            ) : (
              <ScrollArea className="max-h-[250px]">
                <div className="p-2">
                  {availableDatasets.map(dataset => (
                    <button
                      key={dataset.id}
                      onClick={() => handleDatasetSelect(dataset)}
                      className={cn(
                        'w-full text-left px-3 py-2.5 rounded-md',
                        'hover:bg-accent transition-colors',
                        referenceInfo?.datasetId === dataset.id && 'bg-accent'
                      )}
                    >
                      <div className="text-sm font-medium">{dataset.name}</div>
                      {(dataset.samples || dataset.features) && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {dataset.samples && `${dataset.samples} samples`}
                          {dataset.samples && dataset.features && ' · '}
                          {dataset.features && `${dataset.features} features`}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
});

export default ReferenceModeControls;
