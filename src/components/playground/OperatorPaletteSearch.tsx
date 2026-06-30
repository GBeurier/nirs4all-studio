import { Plus, Search } from 'lucide-react';
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
import type { OperatorDefinition } from '@/types/playground';
import {
  getOperatorKey,
  type OperatorsByTab,
  type PlaygroundTabType,
} from '@/lib/playground/operatorPaletteData';
import { OperatorPaletteCategoryIcon } from './OperatorPaletteCategorySection';

interface OperatorPaletteSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  filteredOperators: OperatorsByTab;
  onSelect: (definition: OperatorDefinition) => void;
  showSplitterReplacementHint: boolean;
}

const SEARCH_GROUPS: Array<{ type: PlaygroundTabType; heading: string }> = [
  { type: 'preprocessing', heading: 'Preprocessing' },
  { type: 'augmentation', heading: 'Augmentation' },
  { type: 'splitting', heading: 'Splitting' },
  { type: 'filter', heading: 'Filtering' },
];

export function OperatorPaletteSearch({
  open,
  onOpenChange,
  searchQuery,
  onSearchQueryChange,
  filteredOperators,
  onSelect,
  showSplitterReplacementHint,
}: OperatorPaletteSearchProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
            onValueChange={onSearchQueryChange}
          />
          <CommandList className="max-h-80">
            <CommandEmpty>No operators found.</CommandEmpty>

            {SEARCH_GROUPS.map(({ type, heading }) => (
              <OperatorSearchGroup
                key={type}
                type={type}
                heading={heading}
                operators={filteredOperators[type]}
                onSelect={onSelect}
                showSplitterReplacementHint={type === 'splitting' && showSplitterReplacementHint}
              />
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface OperatorSearchGroupProps {
  type: PlaygroundTabType;
  heading: string;
  operators: OperatorDefinition[];
  onSelect: (definition: OperatorDefinition) => void;
  showSplitterReplacementHint: boolean;
}

function OperatorSearchGroup({
  type,
  heading,
  operators,
  onSelect,
  showSplitterReplacementHint,
}: OperatorSearchGroupProps) {
  if (operators.length === 0) {
    return null;
  }

  return (
    <CommandGroup heading={heading}>
      {operators.map(op => {
        return (
          <CommandItem
            key={getOperatorKey(op)}
            value={`${op.name} ${op.description}`}
            onSelect={() => onSelect(op)}
            className="gap-2 cursor-pointer"
          >
            <OperatorPaletteCategoryIcon category={op.category} type={type} className="w-4 h-4" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {op.display_name}
                {showSplitterReplacementHint && (
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
  );
}
