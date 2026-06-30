import { useState } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toggleInspectorFacetValue } from '@/lib/inspector/sourceFilterBar';

interface InspectorSourceFacetFilterProps {
  label: string;
  values: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function InspectorSourceFacetFilter({
  label,
  values,
  selected,
  onChange,
}: InspectorSourceFacetFilterProps) {
  const [open, setOpen] = useState(false);
  const count = selected.length;
  const total = values.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={count > 0 ? 'secondary' : 'outline'}
          size="sm"
          className="h-7 px-2.5 text-xs gap-1.5 shrink-0"
        >
          <span>{label}</span>
          {count > 0 && (
            <Badge variant="default" className="h-4 px-1 text-[10px] rounded-full min-w-4 justify-center">
              {count}/{total}
            </Badge>
          )}
          <ChevronsUpDown className="w-3 h-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}...`} className="h-8 text-xs" />
          <div className="flex items-center gap-1 px-2 py-1.5 border-b">
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => onChange([...values])}>
              All
            </Button>
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => onChange([])}>
              None
            </Button>
          </div>
          <CommandList>
            <CommandEmpty className="py-3 text-xs">No results.</CommandEmpty>
            <CommandGroup>
              {values.map(value => {
                const isSelected = selected.includes(value);
                return (
                  <CommandItem
                    key={value}
                    value={value}
                    onSelect={() => onChange(toggleInspectorFacetValue(selected, value))}
                    className="text-xs gap-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={isSelected}
                      className="h-3.5 w-3.5"
                      tabIndex={-1}
                    />
                    <span className="truncate flex-1">{value}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
