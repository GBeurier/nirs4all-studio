import { useState, useCallback, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
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
  GripVertical,
} from "lucide-react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { usePipelineDnd } from "./PipelineDndContext";
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
  const { isDragging: globalIsDragging } = usePipelineDnd();

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${stepType}-${option.name}`,
    data: {
      type: "palette-item" as const,
      stepType,
      option,
    },
  });

  const Icon = stepIcons[stepType];
  const colors = stepColors[stepType];

  return (
    <motion.div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onDoubleClick={onDoubleClick}
      layout
      initial={false}
      animate={{
        opacity: isDragging ? 0.4 : 1,
        scale: isDragging ? 0.98 : 1,
      }}
      whileHover={!globalIsDragging ? { scale: 1.01, y: -1 } : {}}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.15 }}
      className={`
        flex items-center gap-2 p-2 rounded-md border cursor-grab active:cursor-grabbing
        transition-colors select-none overflow-hidden
        ${colors.border} ${colors.bg} ${colors.hover}
        ${isDragging ? "ring-2 ring-primary shadow-lg" : ""}
      `}
    >
      <GripVertical className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
      <div className={`p-1 rounded ${colors.bg} ${colors.text} flex-shrink-0`}>
        <Icon className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="text-xs font-medium text-foreground truncate">{option.name}</p>
        <p className="text-[10px] text-muted-foreground truncate leading-tight">{option.description}</p>
      </div>
    </motion.div>
  );
}

interface StepPaletteProps {
  onAddStep: (stepType: StepType, option: StepOption) => void;
}

export function StepPalette({ onAddStep }: StepPaletteProps) {
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Set<StepType>>(new Set(["preprocessing"]));

  const filteredOptions = useCallback(
    (type: StepType) =>
      stepOptions[type].filter(
        (opt) =>
          opt.name.toLowerCase().includes(search.toLowerCase()) ||
          opt.description.toLowerCase().includes(search.toLowerCase())
      ),
    [search]
  );

  // When search changes, open all sections that have matches
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (value.trim()) {
      // Open all sections that have matching results
      const matchingSections = new Set<StepType>();
      (Object.keys(stepOptions) as StepType[]).forEach((type) => {
        const matches = stepOptions[type].filter(
          (opt) =>
            opt.name.toLowerCase().includes(value.toLowerCase()) ||
            opt.description.toLowerCase().includes(value.toLowerCase())
        );
        if (matches.length > 0) {
          matchingSections.add(type);
        }
      });
      setOpenSections(matchingSections);
    }
  };

  const toggleSection = (type: StepType) => {
    setOpenSections((prev) => {
      // If search is active, allow multiple sections
      if (search) {
        const next = new Set(prev);
        if (next.has(type)) {
          next.delete(type);
        } else {
          next.add(type);
        }
        return next;
      }
      // Otherwise, exclusive mode - only one section open at a time
      if (prev.has(type)) {
        return new Set<StepType>();
      }
      return new Set<StepType>([type]);
    });
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
            onChange={(e) => handleSearchChange(e.target.value)}
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
                open={openSections.has(type)}
                onOpenChange={() => toggleSection(type)}
              >
                <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-1.5 hover:bg-muted/50 rounded px-2 -mx-2 transition-colors">
                  {openSections.has(type) ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className={`p-1 rounded ${colors.bg} flex-shrink-0`}>
                    <Icon className={`h-3 w-3 ${colors.text}`} />
                  </div>
                  <span className="font-medium text-xs text-foreground flex-1 truncate">
                    {stepTypeLabels[type]}
                  </span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                    {options.length}
                  </Badge>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-1">
                  <div className="space-y-1 pl-5">
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
