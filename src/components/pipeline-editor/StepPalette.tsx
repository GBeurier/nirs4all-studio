import { useState, useCallback, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  Waves,
  Shuffle,
  Target,
  BarChart3,
  Search,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitMerge,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import {
  stepOptions,
  stepTypeLabels,
  stepColors,
  type StepType,
  type StepOption,
} from "./types";

const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  splitting: Shuffle,
  model: Target,
  metrics: BarChart3,
  branch: GitBranch,
  merge: GitMerge,
};

interface DraggableStepProps {
  stepType: StepType;
  option: StepOption;
  onDoubleClick: () => void;
}

function DraggableStep({ stepType, option, onDoubleClick }: DraggableStepProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${stepType}-${option.name}`,
    data: {
      type: "palette-item",
      stepType,
      option,
    },
  });

  const Icon = stepIcons[stepType];
  const colors = stepColors[stepType];

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onDoubleClick={onDoubleClick}
      className={`flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-all ${colors.border} ${colors.bg} ${colors.hover} ${
        isDragging ? "ring-2 ring-primary shadow-lg scale-105" : ""
      }`}
    >
      <Icon className={`h-4 w-4 flex-shrink-0 ${colors.text}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{option.name}</p>
        <p className="text-xs text-muted-foreground truncate">{option.description}</p>
      </div>
    </div>
  );
}

interface StepPaletteProps {
  onAddStep: (stepType: StepType, option: StepOption) => void;
}

export function StepPalette({ onAddStep }: StepPaletteProps) {
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Record<StepType, boolean>>({
    preprocessing: true,
    splitting: true,
    model: true,
    metrics: true,
    branch: true,
    merge: true,
  });

  const filteredOptions = useCallback(
    (type: StepType) =>
      stepOptions[type].filter(
        (opt) =>
          opt.name.toLowerCase().includes(search.toLowerCase()) ||
          opt.description.toLowerCase().includes(search.toLowerCase())
      ),
    [search]
  );

  const toggleSection = (type: StepType) => {
    setOpenSections((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const totalSteps = useMemo(
    () =>
      (Object.keys(stepOptions) as StepType[]).reduce(
        (acc, type) => acc + filteredOptions(type).length,
        0
      ),
    [filteredOptions]
  );

  return (
    <div className="h-full flex flex-col bg-card border-r border-border">
      {/* Header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Components</h2>
          <Badge variant="secondary" className="text-xs">
            {totalSteps} steps
          </Badge>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search components..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Drag to canvas or double-click to add
        </p>
      </div>

      {/* Step Categories */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {(Object.keys(stepOptions) as StepType[]).map((type) => {
            const Icon = stepIcons[type];
            const colors = stepColors[type];
            const options = filteredOptions(type);
            if (options.length === 0 && search) return null;

            return (
              <Collapsible
                key={type}
                open={openSections[type]}
                onOpenChange={() => toggleSection(type)}
              >
                <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 hover:bg-muted/50 rounded px-2 -mx-2 transition-colors">
                  {openSections[type] ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div className={`p-1.5 rounded ${colors.bg}`}>
                    <Icon className={`h-3.5 w-3.5 ${colors.text}`} />
                  </div>
                  <span className="font-medium text-sm text-foreground flex-1">
                    {stepTypeLabels[type]}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {options.length}
                  </Badge>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="space-y-2 pl-6">
                    {options.map((option) => (
                      <DraggableStep
                        key={option.name}
                        stepType={type}
                        option={option}
                        onDoubleClick={() => onAddStep(type, option)}
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
