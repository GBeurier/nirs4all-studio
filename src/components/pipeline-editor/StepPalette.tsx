import { useState, useCallback, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Waves,
  Shuffle,
  Target,
  Search,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitMerge,
  GripVertical,
  Sparkles,
  Filter,
  Zap,
  BarChart3,
  Star,
  Layers,
  Combine,
  LineChart,
  MessageSquare,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePipelineDnd } from "./PipelineDndContext";
import {
  stepOptions,
  stepTypeLabels,
  stepColors,
  type StepType,
  type StepOption,
} from "./types";
import { useNodeRegistryOptional, type NodeDefinition } from "./contexts/NodeRegistryContext";

const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  y_processing: BarChart3,
  splitting: Shuffle,
  model: Target,
  generator: Sparkles,
  branch: GitBranch,
  merge: GitMerge,
  filter: Filter,
  augmentation: Zap,
  sample_augmentation: Zap,
  feature_augmentation: Layers,
  sample_filter: Filter,
  concat_transform: Combine,
  chart: LineChart,
  comment: MessageSquare,
};

/**
 * Convert a NodeDefinition from the registry to a StepOption for backwards compatibility
 */
function nodeDefToStepOption(node: NodeDefinition): StepOption {
  return {
    name: node.name,
    description: node.description,
    defaultParams: node.defaultParams,
    category: node.category,
    isDeepLearning: node.isDeepLearning,
    isAdvanced: node.isAdvanced,
    tags: node.tags,
  };
}

interface DraggableStepProps {
  stepType: StepType;
  option: StepOption;
  onDoubleClick: () => void;
  isCompact?: boolean;
}

function DraggableStep({ stepType, option, onDoubleClick, isCompact = false }: DraggableStepProps) {
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
    <Tooltip>
      <TooltipTrigger asChild>
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
            ${option.isDeepLearning ? "border-l-2 border-l-violet-500" : ""}
          `}
        >
          <GripVertical className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
          <div className={`p-1 rounded ${colors.bg} ${colors.text} flex-shrink-0`}>
            <Icon className="h-3 w-3" />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium text-foreground truncate">{option.name}</p>
              {option.isDeepLearning && (
                <Star className="h-2.5 w-2.5 text-violet-500 flex-shrink-0" />
              )}
            </div>
            {!isCompact && (
              <p className="text-[10px] text-muted-foreground truncate leading-tight">{option.description}</p>
            )}
          </div>
        </motion.div>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[200px]">
        <div className="space-y-1">
          <p className="font-medium">{option.name}</p>
          <p className="text-xs text-muted-foreground">{option.description}</p>
          {option.category && (
            <Badge variant="secondary" className="text-[10px]">{option.category}</Badge>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

interface StepPaletteProps {
  onAddStep: (stepType: StepType, option: StepOption) => void;
}

// Order of step types in the palette (most commonly used first)
// Note: Some categories are merged together (see mergedCategories)
const stepTypeOrder: StepType[] = [
  "preprocessing",
  "splitting",
  "model",
  "y_processing",
  "generator",
  "branch",      // Includes merge
  "filter",      // Includes sample_filter
  "augmentation", // Augmentation operators (noise, drift, etc.)
  "sample_augmentation", // Container types: includes feature_augmentation, concat_transform
  "chart",
  "comment",
];

// Categories that get merged together in the UI
const mergedCategories: Partial<Record<StepType, { types: StepType[]; label: string }>> = {
  branch: { types: ["branch", "merge"], label: "Branching & Merge" },
  filter: { types: ["filter", "sample_filter"], label: "Filters" },
  sample_augmentation: { types: ["sample_augmentation", "feature_augmentation", "concat_transform"], label: "Feature Processing" },
};

// Types that should be hidden because they're merged into another category
const hiddenTypes = new Set<StepType>(["merge", "feature_augmentation", "concat_transform", "sample_filter"]);



export function StepPalette({ onAddStep }: StepPaletteProps) {
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Set<StepType>>(new Set(["preprocessing"]));

  // Try to use the registry if available (Phase 2 feature)
  const registryContext = useNodeRegistryOptional();
  const useRegistry = registryContext?.isJsonRegistry ?? false;

  // Get step options from registry or legacy stepOptions
  const getStepOptionsForType = useCallback((type: StepType): StepOption[] => {
    if (useRegistry && registryContext) {
      // Use the new JSON-based registry
      const nodes = registryContext.getNodesByType(type);
      return nodes.map(nodeDefToStepOption);
    }
    // Fallback to legacy stepOptions
    return stepOptions[type] ?? [];
  }, [useRegistry, registryContext]);

  // Get all options for a type, including merged types
  const getOptionsForType = useCallback((type: StepType): { option: StepOption; actualType: StepType }[] => {
    const merged = mergedCategories[type];
    if (merged) {
      // Return options from all merged types
      return merged.types.flatMap(t =>
        getStepOptionsForType(t).map(opt => ({ option: opt, actualType: t }))
      );
    }
    return getStepOptionsForType(type).map(opt => ({ option: opt, actualType: type }));
  }, [getStepOptionsForType]);

  const filteredOptions = useCallback(
    (type: StepType) => {
      const allOptions = getOptionsForType(type);
      return allOptions.filter(
        ({ option: opt }) =>
          opt.name.toLowerCase().includes(search.toLowerCase()) ||
          opt.description.toLowerCase().includes(search.toLowerCase()) ||
          (opt.category?.toLowerCase().includes(search.toLowerCase()) ?? false)
      );
    },
    [search, getOptionsForType]
  );

  // When search changes, update search state
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (value.trim()) {
      // Open all sections that have matches
      const matchingSections = new Set<StepType>();
      stepTypeOrder.forEach((type) => {
        if (hiddenTypes.has(type)) return;
        const matches = filteredOptions(type);
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

  // Total steps (visible only, not counting hidden merged types)
  const totalSteps = useMemo(
    () =>
      stepTypeOrder
        .filter(type => !hiddenTypes.has(type))
        .reduce(
          (acc, type) => acc + filteredOptions(type).length,
          0
        ),
    [filteredOptions]
  );

  // Threshold for showing subcategories (if total options in a section < this, show flat list)
  const SUBMENU_THRESHOLD = 10;

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
            placeholder="Search steps..."
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
        <div className="p-4 space-y-3">
          {stepTypeOrder.map((type) => {
            // Skip hidden types (they're merged into other categories)
            if (hiddenTypes.has(type)) return null;

            const Icon = stepIcons[type];
            const colors = stepColors[type];
            const options = filteredOptions(type);
            if (options.length === 0 && search) return null;

            // Get the display label (merged or original)
            const merged = mergedCategories[type];
            const displayLabel = merged ? merged.label : stepTypeLabels[type];

            // Group by category (using the option's category or type as fallback for merged)
            const groupedMap = new Map<string, { option: StepOption; actualType: StepType }[]>();
            for (const item of options) {
              // For merged categories, use a combo key to distinguish source types
              const categoryKey = item.option.category || "General";
              if (!groupedMap.has(categoryKey)) {
                groupedMap.set(categoryKey, []);
              }
              groupedMap.get(categoryKey)!.push(item);
            }

            const hasCategories = groupedMap.size > 1 || !groupedMap.has("General");
            const isExpanded = openSections.has(type);
            // Only show subcategories if we have more than SUBMENU_THRESHOLD options
            const shouldShowSubcategories = hasCategories && !search && options.length >= SUBMENU_THRESHOLD;

            return (
              <Collapsible
                key={type}
                open={isExpanded}
                onOpenChange={() => toggleSection(type)}
                className="mb-1"
              >
                <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-1.5 hover:bg-muted/50 rounded px-2 -mx-2 transition-colors group">
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className={`p-1 rounded ${colors.bg} flex-shrink-0`}>
                    <Icon className={`h-3 w-3 ${colors.text}`} />
                  </div>
                  <span className="font-medium text-xs text-foreground flex-1 truncate">
                    {displayLabel}
                  </span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                    {options.length}
                  </Badge>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-1">
                  <div className="pl-5 border-l ml-3.5 border-border/50 space-y-2">
                    {shouldShowSubcategories ? (
                      // Render grouped by category
                      Array.from(groupedMap.entries()).map(([category, categoryItems]) => {
                        const categoryKey = `${type}-${category}`;

                        return (
                          <div key={categoryKey} className="mb-2">
                            <div className="flex items-center gap-1.5 w-full text-left py-1 px-1 text-muted-foreground">
                              <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">{category}</span>
                            </div>
                            <div className="space-y-1 pl-1">
                              {categoryItems.map(({ option, actualType }) => (
                                <DraggableStep
                                  key={`${actualType}-${option.name}`}
                                  stepType={actualType}
                                  option={option}
                                  onDoubleClick={() => onAddStep(actualType, option)}
                                  isCompact={categoryItems.length > 8}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      // Flat list (no categories, searching, or below threshold)
                      <div className="space-y-1">
                        {options.map(({ option, actualType }) => (
                          <DraggableStep
                            key={`${actualType}-${option.name}`}
                            stepType={actualType}
                            option={option}
                            onDoubleClick={() => onAddStep(actualType, option)}
                          />
                        ))}
                      </div>
                    )}
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
