import type { ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface NewExperimentSelectableOptionCardProps {
  children: ReactNode;
  dataAttributeName: "data-experiment-dataset-id" | "data-experiment-pipeline-id";
  optionId: string;
  selected: boolean;
  onToggle: (optionId: string) => void;
}

export function NewExperimentSelectableOptionCard({
  children,
  dataAttributeName,
  optionId,
  selected,
  onToggle,
}: NewExperimentSelectableOptionCardProps) {
  return (
    <div
      {...{ [dataAttributeName]: optionId }}
      onClick={() => onToggle(optionId)}
      className={cn(
        "cursor-pointer rounded-lg border p-4 transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
      )}
    >
      <div className="flex items-center gap-3">
        <Checkbox checked={selected} onCheckedChange={() => onToggle(optionId)} />
        <div className="flex-1 space-y-1">{children}</div>
      </div>
    </div>
  );
}
