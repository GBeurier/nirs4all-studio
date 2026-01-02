import { useState, useMemo } from 'react';
import { operatorDefinitions } from '@/lib/preprocessing/operators';
import { OperatorType } from '@/types/spectral';
import { Button } from '@/components/ui/button';
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
  Waves,
  Scaling,
  TrendingUp,
  ArrowUpRight,
  Spline,
  AlignCenter,
  Maximize2,
  Minus,
  TrendingDown,
  Scissors,
  Search,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Waves,
  Scaling,
  TrendingUp,
  ArrowUpRight,
  Spline,
  AlignCenter,
  Maximize2,
  Minus,
  TrendingDown,
  Scissors,
};

interface OperatorPaletteProps {
  onAddOperator: (type: OperatorType) => void;
}

const categoryLabels: Record<string, string> = {
  scatter: 'Scatter Correction',
  derivative: 'Smoothing & Derivatives',
  normalization: 'Normalization',
  baseline: 'Baseline',
  selection: 'Selection',
};

export function OperatorPalette({ onAddOperator }: OperatorPaletteProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['scatter', 'derivative']));

  const groupedOperators = useMemo(() => {
    return operatorDefinitions.reduce((acc, op) => {
      if (!acc[op.category]) acc[op.category] = [];
      acc[op.category].push(op);
      return acc;
    }, {} as Record<string, typeof operatorDefinitions>);
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

  const handleSelect = (type: OperatorType) => {
    onAddOperator(type);
    setSearchOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Operators
        </h3>
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {operatorDefinitions.length}
        </span>
      </div>

      {/* Quick search button - opens command palette */}
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
        <PopoverContent className="w-72 p-0" align="start" side="right">
          <Command>
            <CommandInput
              placeholder="Search operators..."
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              <CommandEmpty>No operators found.</CommandEmpty>
              {Object.entries(groupedOperators).map(([category, ops]) => {
                const filteredOps = ops.filter(op =>
                  !searchQuery.trim() ||
                  op.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  op.description.toLowerCase().includes(searchQuery.toLowerCase())
                );
                if (filteredOps.length === 0) return null;
                return (
                  <CommandGroup key={category} heading={categoryLabels[category]}>
                    {filteredOps.map(op => {
                      const Icon = iconMap[op.icon] || Waves;
                      return (
                        <CommandItem
                          key={op.type}
                          value={`${op.name} ${op.description}`}
                          onSelect={() => handleSelect(op.type)}
                          className="gap-2 cursor-pointer"
                        >
                          <Icon className="w-4 h-4 text-primary" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{op.name}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {op.description}
                            </div>
                          </div>
                          <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Collapsible category list */}
      <div className="space-y-1">
        {Object.entries(groupedOperators).map(([category, ops]) => (
          <Collapsible
            key={category}
            open={expandedCategories.has(category)}
            onOpenChange={() => toggleCategory(category)}
          >
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors">
                <ChevronRight
                  className={cn(
                    'w-3.5 h-3.5 transition-transform',
                    expandedCategories.has(category) && 'rotate-90'
                  )}
                />
                <span>{categoryLabels[category]}</span>
                <span className="ml-auto text-[10px] opacity-60">{ops.length}</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid grid-cols-2 gap-1 pt-1 pb-2 pl-5">
                {ops.map((op) => {
                  const Icon = iconMap[op.icon] || Waves;
                  return (
                    <Button
                      key={op.type}
                      variant="ghost"
                      size="sm"
                      className="h-auto py-1.5 px-2 flex flex-col items-center gap-0.5 hover:bg-muted justify-start"
                      onClick={() => onAddOperator(op.type)}
                      title={op.description}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-medium leading-tight text-center line-clamp-2">
                        {op.name}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </div>
  );
}
