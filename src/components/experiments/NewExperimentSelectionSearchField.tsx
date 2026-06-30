import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface NewExperimentSelectionSearchFieldProps {
  className?: string;
  placeholder: string;
  value: string;
  onSearchChange: (value: string) => void;
}

export function NewExperimentSelectionSearchField({
  className,
  placeholder,
  value,
  onSearchChange,
}: NewExperimentSelectionSearchFieldProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(event) => onSearchChange(event.target.value)}
        className="pl-9"
      />
    </div>
  );
}
