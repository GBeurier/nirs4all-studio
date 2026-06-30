/**
 * OperatorPalette - Operator selection using shared NodeRegistry
 *
 * Features:
 * - Uses the same NodeRegistry as the Pipeline Editor
 * - Supports preprocessing, augmentation, splitting, and filter operators
 * - Extended mode toggle to show all operators (including advanced ones)
 * - Grouped by categories with collapsible sections
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { AlertCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useNodeRegistryOptional, usePipelineEditorPreferencesOptional, type NodeDefinition, type TierLevel } from '@/components/pipeline-editor/contexts';
import type { OperatorDefinition } from '@/types/playground';
import {
  buildOperatorsByTab,
  countOperatorsByTab,
  filterOperatorsBySearchQuery,
  groupOperatorsByCategory,
  type OperatorPaletteNodeType,
  type PlaygroundTabType,
} from '@/lib/playground/operatorPaletteData';
import { OperatorPaletteCategorySection } from './OperatorPaletteCategorySection';
import { OperatorPaletteSearch } from './OperatorPaletteSearch';

/** Tier selector labels */
const TIER_LABELS: Record<TierLevel, string> = {
  core: "Essential",
  standard: "Standard",
  all: "All",
};

/** Tier selector tooltips */
const TIER_TOOLTIPS: Record<TierLevel, string> = {
  core: "Essential NIRS operators only",
  standard: "Standard operators (nirs4all + common sklearn)",
  all: "All operators including advanced and deep learning",
};

interface OperatorPaletteProps {
  onAddOperator: (definition: OperatorDefinition) => void;
  hasSplitter?: boolean;
  currentSplitterName?: string | null;
}

export function OperatorPalette({
  onAddOperator,
  hasSplitter = false,
  currentSplitterName = null,
}: OperatorPaletteProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<PlaygroundTabType>('preprocessing');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [showSplitterReplacementHint, setShowSplitterReplacementHint] = useState(false);
  const suppressNextSplitterHintRef = useRef(false);

  // Use shared registry and preferences contexts
  const registryContext = useNodeRegistryOptional();
  const prefs = usePipelineEditorPreferencesOptional();

  // Tier level state (synced with pipeline editor)
  const [tierLevelFallback, setTierLevelFallback] = useState<TierLevel>("standard");

  const tierLevel: TierLevel = prefs?.tierLevel ?? tierLevelFallback;
  const setTierLevel = useCallback(
    (value: TierLevel) => {
      if (prefs) {
        prefs.setTierLevel(value);
        return;
      }
      setTierLevelFallback(value);
    },
    [prefs]
  );

  const operatorsByTab = useMemo(() => {
    return buildOperatorsByTab({
      tierLevel,
      getNodesByType: registryContext
        ? (nodeType: OperatorPaletteNodeType) => registryContext.getNodesByType(nodeType as NodeDefinition['type'])
        : undefined,
    });
  }, [registryContext, tierLevel]);

  const operatorsByCategory = useMemo(() => groupOperatorsByCategory(operatorsByTab), [operatorsByTab]);

  const { preprocessing, augmentation, splitting, filter } = operatorsByTab;
  const {
    preprocessing: preprocessingByCategory,
    augmentation: augmentationByCategory,
    splitting: splittingByCategory,
    filter: filterByCategory,
  } = operatorsByCategory;

  const isLoading = registryContext?.isLoading ?? false;
  const isError = !!registryContext?.error;
  const error = registryContext?.error;
  const extendedError = registryContext?.extendedError ?? null;

  const totalCount = countOperatorsByTab(operatorsByTab);

  // ⌘K / Ctrl+K keyboard shortcut to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!hasSplitter) {
      setShowSplitterReplacementHint(false);
      return;
    }

    if (activeTab !== 'splitting') {
      return;
    }

    if (suppressNextSplitterHintRef.current) {
      suppressNextSplitterHintRef.current = false;
      setShowSplitterReplacementHint(false);
      return;
    }

    setShowSplitterReplacementHint(true);
  }, [activeTab, hasSplitter]);

  const toggleCategory = (category: string) => {
    setExpandedCategory(prev => (prev === category ? null : category));
  };

  const handleSelect = (definition: OperatorDefinition) => {
    if (definition.type === 'splitting' && !hasSplitter) {
      suppressNextSplitterHintRef.current = true;
      setShowSplitterReplacementHint(false);
    }
    onAddOperator(definition);
    setSearchOpen(false);
    setSearchQuery('');
  };

  const replacementHint = currentSplitterName
    ? `Adding another splitter will replace pipeline splitter "${currentSplitterName}".`
    : 'Adding another splitter will replace the current pipeline splitter.';

  const filteredOperators = useMemo(
    () => filterOperatorsBySearchQuery(operatorsByTab, searchQuery),
    [operatorsByTab, searchQuery]
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-8" />
        </div>
        <Skeleton className="h-8 w-full" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">Failed to load operators</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {error?.message || 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {extendedError && (
        <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="text-xs">Extended operators could not be loaded. Showing base operators only.</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Operators
        </h3>
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
            {totalCount}
          </Badge>
          <div className="flex items-center rounded overflow-hidden border border-border">
            {(["core", "standard", "all"] as TierLevel[]).map((tier) => (
              <Tooltip key={tier}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setTierLevel(tier)}
                    className={`text-[9px] font-medium px-1.5 py-0.5 transition-colors ${
                      tierLevel === tier
                        ? "bg-primary/20 text-primary"
                        : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
                    }`}
                  >
                    {TIER_LABELS[tier]}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs max-w-[200px]">
                  {TIER_TOOLTIPS[tier]}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>

      {tierLevel === "all" && registryContext?.isLoading && (
        <div className="text-[10px] text-muted-foreground/70">Loading extended...</div>
      )}

      <OperatorPaletteSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        filteredOperators={filteredOperators}
        onSelect={handleSelect}
        showSplitterReplacementHint={showSplitterReplacementHint}
      />

      {/* Tabbed category list */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'preprocessing' | 'augmentation' | 'splitting' | 'filter')}>
        <TabsList className="grid w-full grid-cols-4 h-8">
          <TabsTrigger value="preprocessing" className="text-[10px] px-1">
            Preproc ({preprocessing.length})
          </TabsTrigger>
          <TabsTrigger value="augmentation" className="text-[10px] px-1">
            Augment ({augmentation.length})
          </TabsTrigger>
          <TabsTrigger value="splitting" className="text-[10px] px-1">
            Split ({splitting.length})
          </TabsTrigger>
          <TabsTrigger value="filter" className="text-[10px] px-1">
            Filter ({filter.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preprocessing" className="mt-2">
          <ScrollArea className="h-[300px] pr-3">
            <div className="space-y-1">
              {Object.entries(preprocessingByCategory).map(([category, ops]) => (
                <OperatorPaletteCategorySection
                  key={category}
                  category={category}
                  type="preprocessing"
                  operators={ops}
                  isExpanded={expandedCategory === category}
                  onToggle={() => toggleCategory(category)}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="augmentation" className="mt-2">
          <ScrollArea className="h-[300px] pr-3">
            <div className="space-y-1">
              {Object.entries(augmentationByCategory).map(([category, ops]) => (
                <OperatorPaletteCategorySection
                  key={category}
                  category={category}
                  type="augmentation"
                  operators={ops}
                  isExpanded={expandedCategory === category}
                  onToggle={() => toggleCategory(category)}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="splitting" className="mt-2">
          <ScrollArea className="h-[300px] pr-3">
            <div className="space-y-1">
              {showSplitterReplacementHint && (
                <div className="text-xs text-orange-500 bg-orange-500/10 px-2 py-1 rounded mb-2">
                  {replacementHint}
                </div>
              )}
              {Object.entries(splittingByCategory).map(([category, ops]) => (
                <OperatorPaletteCategorySection
                  key={category}
                  category={category}
                  type="splitting"
                  operators={ops}
                  isExpanded={expandedCategory === category}
                  onToggle={() => toggleCategory(category)}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="filter" className="mt-2">
          <ScrollArea className="h-[300px] pr-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground bg-muted/50 px-2 py-1.5 rounded mb-2">
                Filters remove samples from the dataset based on criteria
              </div>
              {Object.entries(filterByCategory).map(([category, ops]) => (
                <OperatorPaletteCategorySection
                  key={category}
                  category={category}
                  type="filter"
                  operators={ops}
                  isExpanded={expandedCategory === category}
                  onToggle={() => toggleCategory(category)}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default OperatorPalette;
