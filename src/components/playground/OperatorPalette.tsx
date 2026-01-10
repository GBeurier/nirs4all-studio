/**
 * OperatorPalette - Operator selection using shared NodeRegistry
 *
 * Features:
 * - Uses the same NodeRegistry as the Pipeline Editor
 * - Supports preprocessing, augmentation, splitting, and filter operators
 * - Extended mode toggle to show all operators (including advanced ones)
 * - Grouped by categories with collapsible sections
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Waves,
  Scaling,
  TrendingUp,
  TrendingDown,
  Minus,
  Maximize2,
  Scissors,
  Search,
  Plus,
  ChevronRight,
  Shuffle,
  Grid3X3,
  Layers,
  AlertCircle,
  GitBranch,
  Target,
  Users,
  Ruler,
  Filter,
  XCircle,
  Shield,
  Zap,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useNodeRegistryOptional, usePipelineEditorPreferencesOptional, type NodeDefinition } from '@/components/pipeline-editor/contexts';
import type { OperatorDefinition } from '@/types/playground';

// Icon mapping for operators
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  // Preprocessing
  scatter_correction: Waves,
  derivative: TrendingUp,
  smoothing: TrendingUp,
  baseline: Minus,
  scaling: Scaling,
  wavelet: Layers,
  conversion: TrendingDown,
  features: Scissors,
  // Augmentation
  noise: Waves,
  baseline_drift: TrendingDown,
  wavelength_distortion: Maximize2,
  resolution: TrendingUp,
  masking: Scissors,
  artefacts: Waves,
  mixing: Shuffle,
  scatter_simulation: Waves,
  geometric: Maximize2,
  // Splitting
  kfold: Grid3X3,
  stratified: Target,
  shuffle: Shuffle,
  grouped: Users,
  distance: Ruler,
  // Filter
  outlier: XCircle,
  range: Filter,
  metadata: Layers,
  quality: Shield,
  other: GitBranch,
};

/**
 * Get icon for an operator based on category
 */
function getOperatorIcon(category: string): React.ComponentType<{ className?: string }> {
  return ICON_MAP[category] || Waves;
}

// Playground tab type - maps to the 4 playground categories
type PlaygroundTabType = 'preprocessing' | 'augmentation' | 'splitting' | 'filter';

// Category labels for display
const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  preprocessing: {
    scatter_correction: 'Scatter Correction',
    derivative: 'Derivatives',
    smoothing: 'Smoothing',
    baseline: 'Baseline',
    scaling: 'Scaling',
    wavelet: 'Wavelets',
    conversion: 'Conversion',
    features: 'Features',
    other: 'Other',
  },
  augmentation: {
    noise: 'Noise',
    baseline_drift: 'Baseline Drift',
    wavelength_distortion: 'Wavelength Distortion',
    resolution: 'Resolution & Smoothing',
    masking: 'Masking & Dropout',
    artefacts: 'Artefacts',
    mixing: 'Sample Mixing',
    scatter_simulation: 'Scatter Simulation',
    geometric: 'Geometric',
    container: 'Containers',
    other: 'Other',
  },
  splitting: {
    kfold: 'K-Fold',
    stratified: 'Stratified',
    shuffle: 'Shuffle Split',
    grouped: 'Grouped',
    distance: 'Distance-Based',
    other: 'Other',
  },
  filter: {
    outlier: 'Outlier Detection',
    range: 'Range Filtering',
    metadata: 'Metadata Filtering',
    quality: 'Quality Control',
    distance: 'Distance-Based',
    container: 'Containers',
    other: 'Other',
  },
};

/**
 * Convert NodeDefinition to OperatorDefinition for playground compatibility
 */
function nodeToOperatorDef(node: NodeDefinition, tabType: PlaygroundTabType): OperatorDefinition {
  // Build params from node parameters
  const params: OperatorDefinition['params'] = {};
  if (node.parameters) {
    for (const param of node.parameters) {
      params[param.name] = {
        required: param.required ?? false,
        default: param.default,
        type: param.type,
        default_is_callable: false,
      };
    }
  }

  return {
    name: node.name,
    display_name: node.name,
    description: node.description,
    category: node.category ?? 'other',
    params,
    type: tabType,
    source: node.source,
  };
}

/**
 * Get display label for a category
 */
function getCategoryLabel(category: string, type: PlaygroundTabType): string {
  return CATEGORY_LABELS[type]?.[category] || category;
}

// Extended mode local storage key (shared with pipeline editor)
const EXTENDED_MODE_STORAGE_KEY = "pipelineEditor.extendedMode";

function readLocalStorageBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function writeLocalStorageBoolean(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // ignore
  }
}

interface OperatorPaletteProps {
  onAddOperator: (definition: OperatorDefinition) => void;
  hasSplitter?: boolean;
}

export function OperatorPalette({
  onAddOperator,
  hasSplitter = false,
}: OperatorPaletteProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<PlaygroundTabType>('preprocessing');
  const [expandedCategory, setExpandedCategory] = useState<string | null>('scatter_correction');

  // Use shared registry and preferences contexts
  const registryContext = useNodeRegistryOptional();
  const prefs = usePipelineEditorPreferencesOptional();

  // Extended mode state (synced with pipeline editor)
  const [extendedModeFallback, setExtendedModeFallback] = useState<boolean>(() =>
    readLocalStorageBoolean(EXTENDED_MODE_STORAGE_KEY, false)
  );

  const extendedMode = prefs?.extendedMode ?? extendedModeFallback;
  const setExtendedMode = useCallback(
    (value: boolean) => {
      if (prefs) {
        prefs.setExtendedMode(value);
        return;
      }
      setExtendedModeFallback(value);
      writeLocalStorageBoolean(EXTENDED_MODE_STORAGE_KEY, value);
    },
    [prefs]
  );

  // Get operators from registry, organized by playground tab type
  const operatorsByTab = useMemo(() => {
    const result: Record<PlaygroundTabType, OperatorDefinition[]> = {
      preprocessing: [],
      augmentation: [],
      splitting: [],
      filter: [],
    };

    if (!registryContext) return result;

    // Node types that map to each playground tab
    const typeGroups: Record<PlaygroundTabType, string[]> = {
      preprocessing: ['preprocessing'],
      augmentation: ['augmentation', 'sample_augmentation', 'feature_augmentation'],
      splitting: ['splitting'],
      filter: ['filter', 'sample_filter'],
    };

    for (const [tabType, nodeTypes] of Object.entries(typeGroups) as [PlaygroundTabType, string[]][]) {
      for (const nodeType of nodeTypes) {
        const nodes = registryContext.getNodesByType(nodeType as NodeDefinition['type']);
        for (const node of nodes) {
          // Filter by extended mode
          if (!extendedMode && node.isAdvanced) continue;
          result[tabType].push(nodeToOperatorDef(node, tabType));
        }
      }
    }

    return result;
  }, [registryContext, extendedMode]);

  // Group operators by category
  const operatorsByCategory = useMemo(() => {
    const result: Record<PlaygroundTabType, Record<string, OperatorDefinition[]>> = {
      preprocessing: {},
      augmentation: {},
      splitting: {},
      filter: {},
    };

    for (const [tabType, operators] of Object.entries(operatorsByTab) as [PlaygroundTabType, OperatorDefinition[]][]) {
      for (const op of operators) {
        const category = op.category || 'other';
        if (!result[tabType][category]) {
          result[tabType][category] = [];
        }
        result[tabType][category].push(op);
      }
    }

    return result;
  }, [operatorsByTab]);

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

  const totalCount = preprocessing.length + augmentation.length + splitting.length + filter.length;

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

  const toggleCategory = (category: string) => {
    setExpandedCategory(prev => (prev === category ? null : category));
  };

  const handleSelect = (definition: OperatorDefinition) => {
    onAddOperator(definition);
    setSearchOpen(false);
    setSearchQuery('');
  };

  // Filter operators based on search
  const filteredOperators = useMemo(() => {
    if (!searchQuery.trim()) {
      return { preprocessing, augmentation, splitting, filter };
    }

    const query = searchQuery.toLowerCase();
    return {
      preprocessing: preprocessing.filter(
        op => op.name.toLowerCase().includes(query) ||
              op.display_name.toLowerCase().includes(query) ||
              op.description.toLowerCase().includes(query)
      ),
      augmentation: augmentation.filter(
        op => op.name.toLowerCase().includes(query) ||
              op.display_name.toLowerCase().includes(query) ||
              op.description.toLowerCase().includes(query)
      ),
      splitting: splitting.filter(
        op => op.name.toLowerCase().includes(query) ||
              op.display_name.toLowerCase().includes(query) ||
              op.description.toLowerCase().includes(query)
      ),
      filter: filter.filter(
        op => op.name.toLowerCase().includes(query) ||
              op.display_name.toLowerCase().includes(query) ||
              op.description.toLowerCase().includes(query)
      ),
    };
  }, [preprocessing, augmentation, splitting, filter, searchQuery]);

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
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Operators
        </h3>
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
            {totalCount}
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setExtendedMode(!extendedMode)}
                className={`text-[9px] font-medium px-1.5 py-0.5 rounded transition-colors ${
                  extendedMode
                    ? "bg-primary/20 text-primary hover:bg-primary/30"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {extendedMode ? "EXT" : "STD"}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs max-w-[200px]">
              {extendedMode
                ? "Extended mode: all sklearn, nirs4all, and TensorFlow operators"
                : "Standard mode: curated operators only"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {extendedMode && registryContext?.isLoading && (
        <div className="text-[10px] text-muted-foreground/70">Loading extended...</div>
      )}

      {/* Quick search button */}
      <Popover open={searchOpen} onOpenChange={setSearchOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-muted-foreground gap-2 h-8"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="text-xs">Search operators...</span>
            <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded">⌘K</kbd>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start" side="right">
          <Command>
            <CommandInput
              placeholder="Search operators..."
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList className="max-h-80">
              <CommandEmpty>No operators found.</CommandEmpty>

              {/* Preprocessing results */}
              {filteredOperators.preprocessing.length > 0 && (
                <CommandGroup heading="Preprocessing">
                  {filteredOperators.preprocessing.map(op => {
                    const Icon = getOperatorIcon(op.category);
                    return (
                      <CommandItem
                        key={op.name}
                        value={`${op.name} ${op.description}`}
                        onSelect={() => handleSelect(op)}
                        className="gap-2 cursor-pointer"
                      >
                        <Icon className="w-4 h-4 text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{op.display_name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {op.description}
                          </div>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {/* Augmentation results */}
              {filteredOperators.augmentation.length > 0 && (
                <CommandGroup heading="Augmentation">
                  {filteredOperators.augmentation.map(op => {
                    const Icon = getOperatorIcon(op.category);
                    return (
                      <CommandItem
                        key={op.name}
                        value={`${op.name} ${op.description}`}
                        onSelect={() => handleSelect(op)}
                        className="gap-2 cursor-pointer"
                      >
                        <Icon className="w-4 h-4 text-blue-500" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{op.display_name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {op.description}
                          </div>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {/* Splitting results */}
              {filteredOperators.splitting.length > 0 && (
                <CommandGroup heading="Splitting">
                  {filteredOperators.splitting.map(op => {
                    const Icon = getOperatorIcon(op.category);
                    return (
                      <CommandItem
                        key={op.name}
                        value={`${op.name} ${op.description}`}
                        onSelect={() => handleSelect(op)}
                        className="gap-2 cursor-pointer"
                      >
                        <Icon className="w-4 h-4 text-orange-500" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">
                            {op.display_name}
                            {hasSplitter && (
                              <span className="ml-2 text-[10px] text-orange-500">(replaces)</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {op.description}
                          </div>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {/* Filter results */}
              {filteredOperators.filter.length > 0 && (
                <CommandGroup heading="Filtering">
                  {filteredOperators.filter.map(op => {
                    const Icon = getOperatorIcon(op.category);
                    return (
                      <CommandItem
                        key={op.name}
                        value={`${op.name} ${op.description}`}
                        onSelect={() => handleSelect(op)}
                        className="gap-2 cursor-pointer"
                      >
                        <Icon className="w-4 h-4 text-red-500" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{op.display_name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {op.description}
                          </div>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

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
                <CategorySection
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
                <CategorySection
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
              {hasSplitter && (
                <div className="text-xs text-orange-500 bg-orange-500/10 px-2 py-1 rounded mb-2">
                  Adding a splitter will replace the existing one
                </div>
              )}
              {Object.entries(splittingByCategory).map(([category, ops]) => (
                <CategorySection
                  key={category}
                  category={category}
                  type="splitting"
                  operators={ops}
                  isExpanded={expandedCategory === category}
                  onToggle={() => toggleCategory(category)}
                  onSelect={handleSelect}
                  hasSplitter={hasSplitter}
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
                <CategorySection
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

// Category section component
interface CategorySectionProps {
  category: string;
  type: 'preprocessing' | 'augmentation' | 'splitting' | 'filter';
  operators: OperatorDefinition[];
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: (op: OperatorDefinition) => void;
  hasSplitter?: boolean;
}

function CategorySection({
  category,
  type,
  operators,
  isExpanded,
  onToggle,
  onSelect,
  hasSplitter,
}: CategorySectionProps) {
  const Icon = getOperatorIcon(category);
  const label = getCategoryLabel(category, type);
  const accentColor = type === 'filter' ? 'text-red-500' : type === 'splitting' ? 'text-orange-500' : type === 'augmentation' ? 'text-blue-500' : 'text-primary';

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors">
          <ChevronRight
            className={cn(
              'w-3.5 h-3.5 transition-transform',
              isExpanded && 'rotate-90'
            )}
          />
          <Icon className={cn('w-3.5 h-3.5', accentColor)} />
          <span>{label}</span>
          <span className="ml-auto text-[10px] opacity-60">{operators.length}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-1 pt-1 pb-2 pl-5">
          <TooltipProvider delayDuration={300}>
            {operators.map((op) => (
              <OperatorTooltip key={op.name} operator={op}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto py-1.5 px-2 flex flex-row items-center gap-2 hover:bg-muted justify-start relative w-full"
                  onClick={() => onSelect(op)}
                >
                  <Icon className={cn('w-3.5 h-3.5 shrink-0', accentColor)} />
                  <span className="text-[10px] font-medium leading-tight text-left line-clamp-1">
                    {op.display_name}
                  </span>
                  {hasSplitter && type === 'splitting' && (
                    <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-orange-500 rounded-full" />
                  )}
                </Button>
              </OperatorTooltip>
            ))}
          </TooltipProvider>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * OperatorTooltip - Rich tooltip showing operator details and parameters
 */
interface OperatorTooltipProps {
  operator: OperatorDefinition;
  children: React.ReactNode;
}

function OperatorTooltip({ operator, children }: OperatorTooltipProps) {
  const paramCount = Object.keys(operator.params).filter(k => !k.startsWith('_')).length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        className="max-w-xs p-3 bg-popover text-popover-foreground border shadow-lg"
      >
        <div className="space-y-2">
          <div>
            <div className="font-semibold text-sm">{operator.display_name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {operator.description}
            </div>
          </div>

          {paramCount > 0 && (
            <div className="pt-1 border-t border-border">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Parameters
              </div>
              <div className="space-y-0.5">
                {Object.entries(operator.params)
                  .filter(([key]) => !key.startsWith('_'))
                  .slice(0, 4)
                  .map(([key, info]) => (
                    <div key={key} className="flex items-center gap-1 text-[11px]">
                      <code className="text-xs bg-muted px-1 rounded">{key}</code>
                      {info.required && (
                        <span className="text-destructive text-[10px]">*</span>
                      )}
                      {info.default !== undefined && !info.default_is_callable && (
                        <span className="text-muted-foreground">
                          = {formatDefaultValue(info.default)}
                        </span>
                      )}
                    </div>
                  ))}
                {paramCount > 4 && (
                  <div className="text-[10px] text-muted-foreground">
                    +{paramCount - 4} more...
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="pt-1 border-t border-border text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Plus className="w-2.5 h-2.5" />
              Click to add to pipeline
            </span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Format a default value for display
 */
function formatDefaultValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `"${value}"`;
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') return '{...}';
  return String(value);
}

export default OperatorPalette;
