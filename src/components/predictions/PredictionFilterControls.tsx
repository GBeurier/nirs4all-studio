import type { ReactNode } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const toggleItemClass = "h-7 px-2 text-[11px] border-border/60 hover:bg-muted/60 hover:text-foreground data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10 data-[state=on]:text-primary";

interface PredictionSearchFilterProps {
  value: string;
  onValueChange: (value: string) => void;
}

interface PredictionFacetSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  allLabel: string;
  placeholder: string;
  triggerClassName: string;
  icon?: ReactNode;
}

export interface PredictionVisibilityToggleOption<T extends string> {
  value: T;
  label: string;
}

interface PredictionVisibilityToggleGroupProps<T extends string> {
  label: string;
  value: T[];
  options: readonly PredictionVisibilityToggleOption<T>[];
  onValueChange: (value: T[]) => void;
}

export function PredictionSearchFilter({
  value,
  onValueChange,
}: PredictionSearchFilterProps) {
  return (
    <div className="relative flex-1 min-w-[180px] max-w-sm">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder="Search models, datasets..."
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-8 bg-muted/50 pl-9 text-sm"
      />
    </div>
  );
}

export function PredictionFacetSelect({
  value,
  onValueChange,
  options,
  allLabel,
  placeholder,
  triggerClassName,
  icon,
}: PredictionFacetSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={placeholder}
        className={cn("h-8 bg-muted/50 text-xs", triggerClassName)}
      >
        {icon}
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PredictionVisibilityToggleGroup<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: PredictionVisibilityToggleGroupProps<T>) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/20 px-1 py-1">
      <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <ToggleGroup
        type="multiple"
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue.length > 0) onValueChange(nextValue as T[]);
        }}
        variant="outline"
        size="sm"
        className="h-7"
      >
        {options.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            className={toggleItemClass}
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
