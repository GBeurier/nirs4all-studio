import { useState, useCallback, useMemo, useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Waves,
  Shuffle,
  Target,
  Search,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GripVertical,
  Sparkles,
  Filter,
  Zap,
  BarChart3,
  Star,
} from "lucide-react";
import { motion } from "@/lib/motion";
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
  type PipelineStep,
} from "./types";
import { useNodeRegistryOptional, type NodeDefinition } from "./contexts/NodeRegistryContext";
import { usePipelineEditorPreferencesOptional, type TierLevel } from "./contexts/PipelineEditorPreferencesContext";
import { parametersToDefaultParams } from "@/data/nodes";

const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  y_processing: BarChart3,
  splitting: Shuffle,
  model: Target,
  filter: Filter,
  augmentation: Zap,
  flow: GitBranch,
  utility: Sparkles,
};

/**
 * Convert a NodeDefinition from the registry to a StepOption for backwards compatibility
 */
function nodeDefToStepOption(node: NodeDefinition): StepOption {
  // For container/generator nodes, create initial branches array based on defaultBranches count
  let defaultBranches: PipelineStep[][] | undefined = undefined;
  if (node.defaultBranches !== undefined && node.defaultBranches > 0) {
    // Create empty branches based on the count
    defaultBranches = Array.from({ length: node.defaultBranches }, () => []);
  } else if (node.isContainer && (node.type === 'branch' || node.type === 'generator')) {
    // Default to 2 branches for container types if not specified
    defaultBranches = [[], []];
  }

  return {
    name: node.name,
    description: node.description,
    defaultParams: parametersToDefaultParams(node.parameters ?? []),
    category: node.category,
    isDeepLearning: node.isDeepLearning,
    isAdvanced: node.isAdvanced,
    tags: node.tags,
    defaultBranches,
    generatorKind: node.generatorKind,
    tier: node.tier,
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
            transition-colors select-none overflow-hidden w-full border-box
            ${colors.border} ${colors.bg} ${colors.hover}
            ${isDragging ? "ring-2 ring-primary shadow-lg" : ""}
            ${option.isDeepLearning ? "border-l-2 border-l-violet-500" : ""}
          `}
        >
          <GripVertical className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
          <div className={`p-1 rounded ${colors.bg} ${colors.text} flex-shrink-0`}>
            <Icon className="h-3 w-3" />
          </div>
          <div className="min-w-0 flex-1 w-0">
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
      <TooltipContent
        side="right"
        sideOffset={10}
        className="max-w-[260px] p-0 overflow-hidden bg-popover text-popover-foreground border-border shadow-xl z-50"
      >
        <div className="p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-sm">{option.name}</p>
            {option.category && (
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 shrink-0 font-normal">{option.category}</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{option.description}</p>
          {option.isDeepLearning && (
             <div className="flex items-center gap-1.5 pt-1">
               <div className="h-1.5 w-1.5 rounded-full bg-violet-500" />
               <span className="text-[10px] text-muted-foreground">Deep Learning Model</span>
             </div>
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
const stepTypeOrder: StepType[] = [
  "preprocessing",
  "splitting",
  "model",
  "y_processing",
  "flow",
  "filter",
  "augmentation",
  "utility",
];

/** Tier selector labels */
const TIER_LABELS: Record<TierLevel, string> = {
  core: "Essential",
  standard: "Standard",
  all: "All",
};

/** Tier selector tooltips */
const TIER_TOOLTIPS: Record<TierLevel, string> = {
  core: "Essential NIRS operators only",
  standard: "Standard operators (nirs4all + common sklearn)",
  all: "All operators including advanced and deep learning",
};

/** Check if a StepOption passes the tier filter */
function passesTierFilter(opt: StepOption, tierLevel: TierLevel): boolean {
  if (tierLevel === "all") return true;
  const tier = opt.tier ?? (opt.isAdvanced ? "advanced" : "standard");
  if (tierLevel === "core") return tier === "core";
  // "standard" — exclude advanced
  return tier !== "advanced";
}



export function StepPalette({ onAddStep }: StepPaletteProps) {
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Set<StepType>>(new Set(["preprocessing"]));
  const prefs = usePipelineEditorPreferencesOptional();
  const [tierLevelFallback, setTierLevelFallback] = useState<TierLevel>("standard");

  const tierLevel: TierLevel = prefs?.tierLevel ?? tierLevelFallback;
  const setTierLevel = useCallback(
    (value: TierLevel) => {
      if (prefs) {
        prefs.setTierLevel(value);
        return;
      }
      setTierLevelFallback(value);
    },
    [prefs]
  );

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

  // Get all options for a type
  const getOptionsForType = useCallback((type: StepType): { option: StepOption; actualType: StepType }[] => {
    return getStepOptionsForType(type).map(opt => ({ option: opt, actualType: type }));
  }, [getStepOptionsForType]);

  const filteredOptions = useCallback(
    (type: StepType) => {
      const allOptions = getOptionsForType(type);
      return allOptions.filter(
        ({ option: opt }) =>
          passesTierFilter(opt, tierLevel) &&
          (
            opt.name.toLowerCase().includes(search.toLowerCase()) ||
            opt.description.toLowerCase().includes(search.toLowerCase()) ||
            (opt.category?.toLowerCase().includes(search.toLowerCase()) ?? false)
          )
      );
    },
    [search, getOptionsForType, tierLevel]
  );

  // Keep the open sections consistent when toggling extended mode during an active search.
  useEffect(() => {
    if (!search.trim()) return;
    const matchingSections = new Set<StepType>();
    stepTypeOrder.forEach((type) => {
      const matches = filteredOptions(type);
      if (matches.length > 0) matchingSections.add(type);
    });
    setOpenSections(matchingSections);
  }, [tierLevel, search, filteredOptions]);

  // When search changes, update search state
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (value.trim()) {
      // Open all sections that have matches
      const matchingSections = new Set<StepType>();
      stepTypeOrder.forEach((type) => {
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
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-foreground">Components</h2>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {totalSteps}
            </Badge>
            <div className="flex items-center rounded overflow-hidden border border-border">
              {(["core", "standard", "all"] as TierLevel[]).map((tier) => (
                <Tooltip key={tier}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setTierLevel(tier)}
                      className={`text-[9px] font-medium px-1.5 py-0.5 transition-colors ${
                        tierLevel === tier
                          ? "bg-primary/20 text-primary"
                          : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
                      }`}
                    >
                      {TIER_LABELS[tier]}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs max-w-[200px]">
                    {TIER_TOOLTIPS[tier]}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        </div>

        {tierLevel === "all" && registryContext?.isLoading && (
          <div className="text-[10px] text-muted-foreground/70">Loading extended...</div>
        )}
        {registryContext?.error && (
          <div className="text-[10px] text-destructive">{registryContext.error.message}</div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Step Categories */}
      <ScrollArea className="flex-1">
        <div className="pl-4 py-4 pr-5 space-y-3">
          {stepTypeOrder.map((type) => {
            const Icon = stepIcons[type];
            const colors = stepColors[type];
            const options = filteredOptions(type);
            if (options.length === 0 && search) return null;

            const displayLabel = stepTypeLabels[type];

            // Group by category
            const groupedMap = new Map<string, { option: StepOption; actualType: StepType }[]>();
            for (const item of options) {
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
                  <div className="space-y-2">
                    {shouldShowSubcategories ? (
                      // Render grouped by category
                      Array.from(groupedMap.entries()).map(([category, categoryItems]) => {
                        const categoryKey = `${type}-${category}`;

                        return (
                          <div key={categoryKey} className="mb-2">
                            <div className="flex items-center gap-1.5 w-full text-left py-1 px-1 text-muted-foreground">
                              <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">{category}</span>
                            </div>
                            <div className="space-y-1">
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
