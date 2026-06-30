/**
 * OrGenerator - Step-level OR generator UI components
 *
 * Provides intuitive interface for creating step alternatives with:
 * - Visual container for OR options
 * - Drag-and-drop support for adding steps
 * - Pick/Arrange mode selection (combinations vs permutations)
 * - Per-option configuration
 * - Variant count display
 */

import { useState, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import {
  Sparkles,
  Plus,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PipelineStep, StepType, StepOption } from "./types";
import { getStepColor, stepColors } from "./stepPresentation";
import { useStepMetadataCatalog } from "./shared/stepMetadata";
import {
  calculateOrVariants,
  canRemoveOrBranch,
  coerceOrSelectionCount,
  coerceOrSelectionRangeEnd,
  coerceOrSelectionRangeStart,
  getFilteredStepOptionGroups,
  getOrDropZoneClassNames,
  getOrGeneratorSummary,
  getOrSelectionActionLabel,
  getOrSelectionKindLabel,
  getOrVariantLabel,
  isRange,
  selectionModeLabels,
} from "./OrGeneratorData";
import type { SelectionConfig, SelectionMode } from "./OrGeneratorData";
import { OrOptionItem } from "./OrGeneratorOption";

export { OrOptionItem } from "./OrGeneratorOption";

/**
 * OrGeneratorContainer - Main container for OR generator visualization
 */
interface OrGeneratorContainerProps {
  /** The generator step containing the branches */
  step: PipelineStep;
  /** Options (first element of each branch) */
  options: PipelineStep[];
  /** Selection configuration */
  selection: SelectionConfig;
  /** Currently selected option index */
  selectedIndex?: number;
  /** Callback when an option is selected */
  onSelectOption?: (index: number) => void;
  /** Callback when an option is removed */
  onRemoveOption?: (index: number) => void;
  /** Callback when an option is duplicated */
  onDuplicateOption?: (index: number) => void;
  /** Callback when an option is updated */
  onUpdateOption?: (index: number, updates: Partial<PipelineStep>) => void;
  /** Callback when selection mode changes */
  onSelectionChange?: (selection: SelectionConfig) => void;
  /** Callback to add a new option */
  onAddOption?: (type: StepType, option: StepOption) => void;
  /** Callback to wrap selected steps */
  onWrapSteps?: (stepIds: string[]) => void;
  /** Whether the container is in edit mode */
  isEditing?: boolean;
  /** Additional class names */
  className?: string;
}

export function OrGeneratorContainer({
  options,
  selection,
  selectedIndex,
  onSelectOption,
  onRemoveOption,
  onDuplicateOption,
  onUpdateOption,
  onSelectionChange,
  onAddOption,
  isEditing = true,
  className,
}: OrGeneratorContainerProps) {
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());
  const [showAddPopover, setShowAddPopover] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { getStepOptions } = useStepMetadataCatalog();

  // Calculate variant count
  const variantCount = useMemo(
    () => calculateOrVariants(options.length, selection),
    [options.length, selection]
  );
  const generatorSummary = getOrGeneratorSummary(options.length, variantCount);

  // Toggle option expansion
  const toggleExpand = useCallback((index: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Filter step options based on search
  const filteredStepOptions = useMemo(() => {
    return getFilteredStepOptionGroups(searchQuery, getStepOptions);
  }, [searchQuery, getStepOptions]);

  return (
    <div
      className={cn(
        "rounded-xl border-2 border-dashed border-orange-500/30 bg-orange-500/5 p-4 space-y-4",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-orange-500/20">
            <Sparkles className="h-4 w-4 text-orange-500" />
          </div>
          <div>
            <h4 className="font-medium text-sm text-orange-600">
              Choose (_or_)
            </h4>
            <p className="text-xs text-muted-foreground">
              {generatorSummary}
            </p>
          </div>
        </div>

        {/* Selection Mode */}
        {isEditing && onSelectionChange && (
          <Select
            value={selection.mode}
            onValueChange={(mode: SelectionMode) =>
              onSelectionChange({ ...selection, mode })
            }
          >
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              {Object.entries(selectionModeLabels).map(([mode, { label }]) => (
                <SelectItem key={mode} value={mode}>
                  <div className="flex flex-col">
                    <span>{label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Pick / Arrange configuration */}
      {(selection.mode === "pick" || selection.mode === "arrange") && isEditing && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-background/50">
          <Label className="text-xs text-muted-foreground">
            {getOrSelectionActionLabel(selection.mode)}
          </Label>
          {isRange(selection.value) ? (
            (() => {
              const rangeValue = selection.value as [number, number];
              return (
                <>
                  <Input
                    type="number"
                    min={1}
                    max={rangeValue[1]}
                    value={rangeValue[0]}
                    onChange={(e) =>
                      onSelectionChange?.({
                        ...selection,
                        value: [
                          coerceOrSelectionRangeStart(e.target.value),
                          rangeValue[1],
                        ],
                      })
                    }
                    className="w-12 h-7 text-xs font-mono"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="number"
                    min={rangeValue[0]}
                    max={options.length}
                    value={rangeValue[1]}
                    onChange={(e) =>
                      onSelectionChange?.({
                        ...selection,
                        value: [
                          rangeValue[0],
                          coerceOrSelectionRangeEnd(
                            e.target.value,
                            rangeValue[0],
                            options.length,
                          ),
                        ],
                      })
                    }
                    className="w-12 h-7 text-xs font-mono"
                  />
                </>
              );
            })()
          ) : (
            <Input
              type="number"
              min={1}
              max={options.length}
              value={selection.value || 2}
              onChange={(e) =>
                onSelectionChange?.({
                  ...selection,
                  value: coerceOrSelectionCount(e.target.value, options.length, 2),
                })
              }
              className="w-14 h-7 text-xs font-mono"
            />
          )}
          <Label className="text-xs text-muted-foreground">
            of {options.length} {getOrSelectionKindLabel(selection.mode)}
          </Label>
          <Badge variant="secondary" className="ml-auto text-xs">
            {getOrVariantLabel(variantCount)}
          </Badge>
        </div>
      )}

      {/* Options List */}
      <div className="space-y-2">
        {options.map((option, index) => (
          <OrOptionItem
            key={option.id}
            option={option}
            index={index}
            isSelected={selectedIndex === index}
            isExpanded={expandedIndices.has(index)}
            onSelect={() => onSelectOption?.(index)}
            onRemove={
              canRemoveOrBranch(options.length)
                ? () => onRemoveOption?.(index)
                : undefined
            }
            onDuplicate={() => onDuplicateOption?.(index)}
            onToggleExpand={() => toggleExpand(index)}
            onUpdate={(updates) => onUpdateOption?.(index, updates)}
          />
        ))}
      </div>

      {/* Add Option */}
      {isEditing && onAddOption && (
        <Popover open={showAddPopover} onOpenChange={setShowAddPopover}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full border-dashed border-orange-500/30 text-orange-500 hover:bg-orange-500/10"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Option
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            className="w-72 p-2 bg-popover"
          >
            <Input
              placeholder="Search operators..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mb-2 h-8 text-sm"
            />
            <ScrollArea className="h-60">
              {filteredStepOptions.map(({ type, options: opts }) => (
                <div key={type} className="mb-2">
                  <div className="text-xs font-medium text-muted-foreground px-2 py-1 capitalize">
                    {type}
                  </div>
                  {opts.slice(0, 6).map((opt) => (
                    <Button
                      key={opt.name}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-xs h-8"
                      onClick={() => {
                        onAddOption(type, opt);
                        setShowAddPopover(false);
                        setSearchQuery("");
                      }}
                    >
                      <span className={stepColors[type].text}>{opt.name}</span>
                    </Button>
                  ))}
                </div>
              ))}
            </ScrollArea>
          </PopoverContent>
        </Popover>
      )}

      {/* Info */}
      <div className="flex items-start gap-2 p-2 rounded-lg bg-background/50 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        <span>
          Each run will use one of these options. Perfect for comparing
          preprocessing methods or model types.
        </span>
      </div>
    </div>
  );
}

/**
 * OrGeneratorDropZone - Drop zone for adding steps to an OR generator
 */
interface OrGeneratorDropZoneProps {
  isActive?: boolean;
  onDrop?: (data: { type: StepType; option: StepOption }) => void;
  className?: string;
}

export function OrGeneratorDropZone({
  isActive = false,
  className,
}: OrGeneratorDropZoneProps) {
  return (
    <div
      className={cn(...getOrDropZoneClassNames(isActive), className)}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4" />
        <span>Drop here to create OR generator</span>
      </div>
    </div>
  );
}

/**
 * WrapInOrGeneratorPopover - Popover to wrap selected steps in OR generator
 */
interface WrapInOrGeneratorPopoverProps {
  selectedSteps: PipelineStep[];
  onWrap: (selection: SelectionConfig) => void;
  onCancel: () => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
}

export function WrapInOrGeneratorPopover({
  selectedSteps,
  onWrap,
  onCancel,
  isOpen,
  onOpenChange,
  trigger,
}: WrapInOrGeneratorPopoverProps) {
  const [selection, setSelection] = useState<SelectionConfig>({ mode: "none" });

  const variantCount = calculateOrVariants(selectedSteps.length, selection);
  const variantSummary = getOrVariantLabel(variantCount);

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      {trigger && <PopoverTrigger asChild>{trigger}</PopoverTrigger>}
      <PopoverContent className="w-80 bg-popover p-4">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-orange-500" />
            <h4 className="font-medium">Create OR Generator</h4>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">
              Wrap {selectedSteps.length} step{selectedSteps.length !== 1 ? "s" : ""} in OR generator
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {selectedSteps.map((step) => (
                <Badge
                  key={step.id}
                  variant="outline"
                  className={cn("text-xs", getStepColor(step).text)}
                >
                  {step.name}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Selection Mode</Label>
            <Select
              value={selection.mode}
              onValueChange={(mode: SelectionMode) =>
                setSelection({ ...selection, mode })
              }
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {Object.entries(selectionModeLabels).map(([mode, { label, description }]) => (
                  <SelectItem key={mode} value={mode}>
                    <div className="flex flex-col">
                      <span>{label}</span>
                      <span className="text-xs text-muted-foreground">{description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Badge variant="secondary" className="bg-orange-500/20 text-orange-600">
              {variantSummary}
            </Badge>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-orange-500 hover:bg-orange-600"
                onClick={() => onWrap(selection)}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
