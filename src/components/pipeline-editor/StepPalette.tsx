import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Search,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
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
import {
  stepColors,
  stepTypeLabels,
} from "./stepPresentation";
import {
  filterPaletteOptions,
  getMatchingPaletteSections,
  getOptionsForPaletteGroup,
  getPaletteAvailabilityDisplay,
  getPaletteGroupDisplayLabel,
  getPaletteOptionAvailability,
  groupPaletteOptionsByCategory,
  resolveStepType,
  shouldShowPaletteSubcategories,
  stepTypeOrder,
  TIER_LABELS,
  TIER_TOOLTIPS,
  type PaletteGroupKey,
} from "./StepPaletteData";
import type {
  StepOption,
  StepType,
} from "./types";
import { useNodeRegistryOptional } from "./contexts/useNodeRegistry";
import { usePipelineEditorPreferencesOptional, type TierLevel } from "./contexts/usePipelineEditorPreferences";
import { useOperatorAvailabilityOptional } from "./contexts/useOperatorAvailability";
import { useStepMetadataCatalog } from "./shared/stepMetadata";
import { stepIcons } from "./StepPaletteIcons";
import { DraggableStep } from "./StepPaletteItem";

interface StepPaletteProps {
  onAddStep: (stepType: StepType, option: StepOption) => void;
}

export function StepPalette({ onAddStep }: StepPaletteProps) {
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Set<PaletteGroupKey>>(new Set());
  const prefs = usePipelineEditorPreferencesOptional();
  const availability = useOperatorAvailabilityOptional();
  const [tierLevelFallback, setTierLevelFallback] = useState<TierLevel>("standard");
  const [showUnavailableFallback, setShowUnavailableFallback] = useState(true);

  const tierLevel: TierLevel = prefs?.tierLevel ?? tierLevelFallback;
  const showUnavailableOperators = prefs?.showUnavailableOperators ?? showUnavailableFallback;
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
  const setShowUnavailableOperators = useCallback(
    (value: boolean) => {
      if (prefs) {
        prefs.setShowUnavailableOperators(value);
        return;
      }
      setShowUnavailableFallback(value);
    },
    [prefs]
  );

  const { getStepOptions } = useStepMetadataCatalog({ tierLevel });

  // Try to use the registry if available (Phase 2 feature)
  const registryContext = useNodeRegistryOptional();

  // Get all options for a palette group (virtual model groups filter by classifier/regressor).
  const getOptionsForGroup = useCallback((key: PaletteGroupKey): { option: StepOption; actualType: StepType }[] => {
    return getOptionsForPaletteGroup(key, getStepOptions);
  }, [getStepOptions]);

  const hasAvailabilitySnapshot = Boolean(availability?.operatorAvailability);
  const getOptionAvailability = useCallback(
    (actualType: StepType, option: StepOption) => {
      return getPaletteOptionAvailability({
        actualType,
        option,
        availability,
        registry: registryContext,
      });
    },
    [availability, registryContext]
  );

  const filteredOptions = useCallback(
    (key: PaletteGroupKey) => {
      const allOptions = getOptionsForGroup(key);
      return filterPaletteOptions(allOptions, {
        search,
        showUnavailableOperators,
        hasAvailabilitySnapshot,
        getOptionAvailability,
      });
    },
    [getOptionAvailability, getOptionsForGroup, hasAvailabilitySnapshot, search, showUnavailableOperators]
  );

  // Keep the open sections consistent when toggling extended mode during an active search.
  useEffect(() => {
    if (!search.trim()) return;
    setOpenSections(getMatchingPaletteSections(stepTypeOrder, filteredOptions));
  }, [search, filteredOptions]);

  // When search changes, update search state
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (value.trim()) {
      // Open all sections that have matches
      setOpenSections(getMatchingPaletteSections(stepTypeOrder, filteredOptions));
    }
  };

  const toggleSection = (key: PaletteGroupKey) => {
    setOpenSections((prev) => {
      // If search is active, allow multiple sections
      if (search) {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      }
      // Otherwise, exclusive mode - only one section open at a time
      if (prev.has(key)) {
        return new Set<PaletteGroupKey>();
      }
      return new Set<PaletteGroupKey>([key]);
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

  const renderDraggableStep = useCallback(
    (actualType: StepType, option: StepOption, isCompact = false) => {
      const optionAvailability = getOptionAvailability(actualType, option);
      const availabilityDisplay = getPaletteAvailabilityDisplay(optionAvailability);
      return (
        <DraggableStep
          key={`${actualType}-${option.name}`}
          stepType={actualType}
          option={option}
          onDoubleClick={() => onAddStep(actualType, option)}
          isCompact={isCompact}
          isUnavailable={availabilityDisplay.isUnavailable}
          unavailableReason={availabilityDisplay.unavailableReason}
        />
      );
    },
    [getOptionAvailability, onAddStep]
  );

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
        {registryContext?.extendedError && (
          <div className="text-[10px] text-amber-600 dark:text-amber-400">Extended operators unavailable</div>
        )}
        {availability?.operatorsError && (
          <div className="text-[10px] text-amber-600 dark:text-amber-400">{availability.operatorsError}</div>
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

        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <label htmlFor="show-unavailable-operators" className="flex items-center gap-2 cursor-pointer">
            <Switch
              id="show-unavailable-operators"
              checked={showUnavailableOperators}
              onCheckedChange={setShowUnavailableOperators}
            />
            <span>Show unavailable operators</span>
          </label>
          {availability?.isLoadingOperators && (
            <span>Checking dependencies...</span>
          )}
        </div>
      </div>

      {/* Step Categories */}
      <ScrollArea className="flex-1">
        <div className="pl-4 py-4 pr-5 space-y-3">
          {stepTypeOrder.map((key) => {
            const underlyingType = resolveStepType(key);
            const Icon = stepIcons[underlyingType];
            const colors = stepColors[underlyingType];
            const options = filteredOptions(key);
            if (options.length === 0 && search) return null;

            const displayLabel = getPaletteGroupDisplayLabel(key, stepTypeLabels);

            // Group by category
            const groupedMap = groupPaletteOptionsByCategory(options);
            const isExpanded = openSections.has(key);
            // Only show subcategories if we have more than SUBMENU_THRESHOLD options
            const shouldShowSubcategories = shouldShowPaletteSubcategories({
              groupedOptions: groupedMap,
              search,
              optionCount: options.length,
              threshold: SUBMENU_THRESHOLD,
            });

            return (
              <Collapsible
                key={key}
                open={isExpanded}
                onOpenChange={() => toggleSection(key)}
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
                        const categoryKey = `${key}-${category}`;

                        return (
                          <div key={categoryKey} className="mb-2">
                            <div className="flex items-center gap-1.5 w-full text-left py-1 px-1 text-muted-foreground">
                              <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">{category}</span>
                            </div>
                            <div className="space-y-1">
                              {categoryItems.map(({ option, actualType }) =>
                                renderDraggableStep(actualType, option, categoryItems.length > 8)
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      // Flat list (no categories, searching, or below threshold)
                      <div className="space-y-1">
                        {options.map(({ option, actualType }) => renderDraggableStep(actualType, option))}
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
