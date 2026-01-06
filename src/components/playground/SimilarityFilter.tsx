/**
 * SimilarityFilter - Find and select samples similar to a reference
 *
 * Phase 5 Implementation: Advanced Filtering & Metrics
 *
 * Features:
 * - Reference selection (click spectrum, use median, or specify index)
 * - Distance metric selector (Euclidean, Cosine, Correlation)
 * - Threshold slider with live preview
 * - Dual mode: "similar to" vs "different from"
 * - Live preview of matching samples
 */

import { useState, useCallback, useMemo } from 'react';
import {
  GitCompare,
  ChevronDown,
  Loader2,
  Check,
  Target,
  ArrowLeftRight,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
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
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useSelection } from '@/context/SelectionContext';
import type { SimilarityResult } from '@/types/playground';

// ============= Types =============

export type DistanceMetric = 'euclidean' | 'cosine' | 'correlation';

export interface SimilarityFilterProps {
  /** Callback to find similar samples via API */
  onFindSimilar: (referenceIdx: number, metric: DistanceMetric, threshold?: number, topK?: number) => Promise<SimilarityResult>;
  /** Currently selected sample index (for reference) */
  selectedSample?: number | null;
  /** Sample IDs for display */
  sampleIds?: string[];
  /** Whether to use SelectionContext for selection */
  useSelectionContext?: boolean;
  /** Callback when similar samples are selected (if not using context) */
  onSelectSimilar?: (indices: number[]) => void;
  /** Total sample count */
  totalSamples: number;
  /** Whether search is in progress */
  isLoading?: boolean;
  /** Compact mode */
  compact?: boolean;
}

// ============= Constants =============

const METRICS: { value: DistanceMetric; label: string; description: string }[] = [
  {
    value: 'euclidean',
    label: 'Euclidean',
    description: 'Standard geometric distance',
  },
  {
    value: 'cosine',
    label: 'Cosine',
    description: 'Angular similarity (shape-focused)',
  },
  {
    value: 'correlation',
    label: 'Correlation',
    description: 'Pearson correlation distance',
  },
];

// ============= Main Component =============

export function SimilarityFilter({
  onFindSimilar,
  selectedSample,
  sampleIds,
  useSelectionContext = true,
  onSelectSimilar,
  totalSamples,
  isLoading = false,
  compact = false,
}: SimilarityFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [referenceIdx, setReferenceIdx] = useState<number | null>(null);
  const [metric, setMetric] = useState<DistanceMetric>('euclidean');
  const [useTopK, setUseTopK] = useState(true);
  const [topK, setTopK] = useState(20);
  const [threshold, setThreshold] = useState<number | undefined>(undefined);
  const [selectDifferent, setSelectDifferent] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [lastResult, setLastResult] = useState<SimilarityResult | null>(null);

  // Selection context
  const { select, selectedSamples, selectedCount } = useSelection();

  // Update reference from selected sample
  const handleUseSelectedAsReference = useCallback(() => {
    if (selectedSample !== null && selectedSample !== undefined) {
      setReferenceIdx(selectedSample);
    } else if (selectedCount === 1) {
      // Use the single selected sample from context
      const idx = Array.from(selectedSamples)[0];
      setReferenceIdx(idx);
    }
  }, [selectedSample, selectedCount, selectedSamples]);

  // Get reference display name
  const referenceDisplay = useMemo(() => {
    if (referenceIdx === null) return 'Not selected';
    if (sampleIds && sampleIds[referenceIdx]) {
      return sampleIds[referenceIdx];
    }
    return `Sample ${referenceIdx}`;
  }, [referenceIdx, sampleIds]);

  // Handle search
  const handleSearch = useCallback(async () => {
    if (referenceIdx === null) return;

    setIsSearching(true);
    try {
      const result = await onFindSimilar(
        referenceIdx,
        metric,
        useTopK ? undefined : threshold,
        useTopK ? topK : undefined
      );
      setLastResult(result);

      if (result.success) {
        let indicesToSelect = result.similar_indices;

        // If selectDifferent mode, we want samples NOT in the similar list
        if (selectDifferent) {
          const similarSet = new Set(result.similar_indices);
          similarSet.add(referenceIdx); // Also exclude reference
          indicesToSelect = Array.from({ length: totalSamples }, (_, i) => i)
            .filter(i => !similarSet.has(i));
        }

        // Apply selection
        if (useSelectionContext) {
          select(indicesToSelect);
        } else if (onSelectSimilar) {
          onSelectSimilar(indicesToSelect);
        }
      }
    } catch (error) {
      console.error('Similarity search failed:', error);
    } finally {
      setIsSearching(false);
    }
  }, [referenceIdx, metric, useTopK, topK, threshold, selectDifferent, totalSamples, onFindSimilar, useSelectionContext, select, onSelectSimilar]);

  // Can use selected sample as reference
  const canUseSelected = (selectedSample !== null && selectedSample !== undefined) || selectedCount === 1;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'text-xs gap-1.5',
            compact ? 'h-7 px-2' : 'h-8 px-3',
            lastResult?.n_similar && lastResult.n_similar > 0 && 'border-blue-500/50 bg-blue-500/5'
          )}
        >
          <GitCompare className="w-3 h-3" />
          Similar
          {lastResult?.n_similar !== undefined && lastResult.n_similar > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
              {lastResult.n_similar}
            </Badge>
          )}
          <ChevronDown className="w-3 h-3 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-blue-500" />
            Similarity Search
          </h4>
        </div>

        <div className="p-3 space-y-4">
          {/* Reference sample */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Reference Sample</Label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  type="number"
                  value={referenceIdx ?? ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setReferenceIdx(isNaN(val) ? null : Math.max(0, Math.min(val, totalSamples - 1)));
                  }}
                  placeholder="Sample index..."
                  className="h-8 text-xs pr-16"
                  min={0}
                  max={totalSamples - 1}
                />
                {referenceIdx !== null && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <Badge variant="outline" className="text-[9px] h-5">
                      {referenceDisplay}
                    </Badge>
                  </div>
                )}
              </div>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2"
                      onClick={handleUseSelectedAsReference}
                      disabled={!canUseSelected}
                    >
                      <Target className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">
                      {canUseSelected
                        ? 'Use currently selected sample as reference'
                        : 'Select a sample first (click on a spectrum or point)'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Distance metric */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Distance Metric</Label>
            <Select value={metric} onValueChange={(v) => setMetric(v as DistanceMetric)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRICS.map(m => (
                  <SelectItem key={m.value} value={m.value}>
                    <div className="flex flex-col">
                      <span>{m.label}</span>
                      <span className="text-[10px] text-muted-foreground">{m.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Selection mode */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Top K nearest</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={useTopK}
                  onCheckedChange={setUseTopK}
                  className="scale-75"
                />
                {useTopK && (
                  <Input
                    type="number"
                    value={topK}
                    onChange={(e) => setTopK(Math.max(1, parseInt(e.target.value) || 1))}
                    className="h-6 w-14 text-xs"
                    min={1}
                    max={totalSamples - 1}
                  />
                )}
              </div>
            </div>

            {!useTopK && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs">Distance threshold</Label>
                  <span className="text-xs font-mono text-primary">
                    {threshold?.toPrecision(3) ?? 'auto'}
                  </span>
                </div>
                <Slider
                  value={[threshold ?? 0.5]}
                  min={0}
                  max={2}
                  step={0.01}
                  onValueChange={([v]) => setThreshold(v)}
                  className="w-full"
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-3 h-3 text-muted-foreground" />
                <Label className="text-xs">Select different (far) samples</Label>
              </div>
              <Switch
                checked={selectDifferent}
                onCheckedChange={setSelectDifferent}
                className="scale-75"
              />
            </div>
          </div>

          {/* Action button */}
          <Button
            variant="default"
            size="sm"
            className="w-full h-8 text-xs"
            onClick={handleSearch}
            disabled={referenceIdx === null || isSearching || isLoading}
          >
            {isSearching ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <GitCompare className="w-3 h-3 mr-1" />
                Find {selectDifferent ? 'Different' : 'Similar'} Samples
              </>
            )}
          </Button>

          {/* Results */}
          {lastResult && lastResult.success && (
            <div className="bg-muted/30 rounded p-2 text-xs">
              <div className="flex items-center gap-2">
                <Check className="w-3 h-3 text-green-500" />
                <span>
                  Found <strong>{lastResult.n_similar}</strong> similar samples
                </span>
              </div>
              {lastResult.distances && lastResult.distances.length > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  Distance range: {lastResult.distances[0]?.toPrecision(3)} -{' '}
                  {lastResult.distances[lastResult.distances.length - 1]?.toPrecision(3)}
                </div>
              )}
            </div>
          )}

          {lastResult && lastResult.error && (
            <div className="bg-red-500/10 rounded p-2 text-xs text-red-500 flex items-center gap-2">
              <X className="w-3 h-3" />
              {lastResult.error}
            </div>
          )}

          {/* Hint */}
          {referenceIdx === null && (
            <div className="text-[10px] text-muted-foreground italic">
              Tip: Click on a spectrum or PCA point, then use the target button to set it as reference.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default SimilarityFilter;
