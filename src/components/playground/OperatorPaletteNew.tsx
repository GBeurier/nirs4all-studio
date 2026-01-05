/**
 * OperatorPaletteNew - Updated operator palette with backend integration
 *
 * Features:
 * - Fetches operators from backend API
 * - Supports both preprocessing and splitting operators
 * - Shows loading and error states
 * - Grouped by categories with collapsible sections
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
  HelpCircle,
  ExternalLink,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useOperatorRegistry, getCategoryLabel } from '@/hooks/useOperatorRegistry';
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
  // Splitting
  kfold: Grid3X3,
  stratified: Target,
  shuffle: Shuffle,
  grouped: Users,
  distance: Ruler,
  other: GitBranch,
};

/**
 * Get icon for an operator based on category
 */
function getOperatorIcon(category: string): React.ComponentType<{ className?: string }> {
  return ICON_MAP[category] || Waves;
}

interface OperatorPaletteNewProps {
  onAddOperator: (definition: OperatorDefinition) => void;
  hasSplitter?: boolean;
}

export function OperatorPaletteNew({
  onAddOperator,
  hasSplitter = false,
}: OperatorPaletteNewProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'preprocessing' | 'splitting'>('preprocessing');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['scatter_correction', 'derivative', 'kfold'])
  );
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  const {
    preprocessing,
    preprocessingByCategory,
    splitting,
    splittingByCategory,
    isLoading,
    isError,
    error,
  } = useOperatorRegistry();

  const totalCount = preprocessing.length + splitting.length;

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
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleSelect = (definition: OperatorDefinition) => {
    onAddOperator(definition);
    setSearchOpen(false);
    setSearchQuery('');
  };

  // Filter operators based on search
  const filteredOperators = useMemo(() => {
    if (!searchQuery.trim()) {
      return { preprocessing, splitting };
    }

    const query = searchQuery.toLowerCase();
    return {
      preprocessing: preprocessing.filter(
        op => op.name.toLowerCase().includes(query) ||
              op.display_name.toLowerCase().includes(query) ||
              op.description.toLowerCase().includes(query)
      ),
      splitting: splitting.filter(
        op => op.name.toLowerCase().includes(query) ||
              op.display_name.toLowerCase().includes(query) ||
              op.description.toLowerCase().includes(query)
      ),
    };
  }, [preprocessing, splitting, searchQuery]);

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
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {totalCount}
        </span>
      </div>

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
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Tabbed category list */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'preprocessing' | 'splitting')}>
        <TabsList className="grid w-full grid-cols-2 h-8">
          <TabsTrigger value="preprocessing" className="text-xs">
            Preprocessing ({preprocessing.length})
          </TabsTrigger>
          <TabsTrigger value="splitting" className="text-xs">
            Splitting ({splitting.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preprocessing" className="mt-2 space-y-1">
          {Object.entries(preprocessingByCategory).map(([category, ops]) => (
            <CategorySection
              key={category}
              category={category}
              type="preprocessing"
              operators={ops}
              isExpanded={expandedCategories.has(category)}
              onToggle={() => toggleCategory(category)}
              onSelect={handleSelect}
            />
          ))}
        </TabsContent>

        <TabsContent value="splitting" className="mt-2 space-y-1">
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
              isExpanded={expandedCategories.has(category)}
              onToggle={() => toggleCategory(category)}
              onSelect={handleSelect}
              hasSplitter={hasSplitter}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Category section component
interface CategorySectionProps {
  category: string;
  type: 'preprocessing' | 'splitting';
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
  const accentColor = type === 'splitting' ? 'text-orange-500' : 'text-primary';

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
        <div className="grid grid-cols-2 gap-1 pt-1 pb-2 pl-5">
          <TooltipProvider delayDuration={300}>
            {operators.map((op) => (
              <OperatorTooltip key={op.name} operator={op}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto py-1.5 px-2 flex flex-col items-center gap-0.5 hover:bg-muted justify-start relative"
                  onClick={() => onSelect(op)}
                >
                  <Icon className={cn('w-3.5 h-3.5', accentColor)} />
                  <span className="text-[10px] font-medium leading-tight text-center line-clamp-2">
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

export default OperatorPaletteNew;
