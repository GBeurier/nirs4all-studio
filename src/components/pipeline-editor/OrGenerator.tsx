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
import {
  Sparkles,
  Plus,
  X,
  GripVertical,
  Settings,
  ChevronDown,
  ChevronUp,
  Shuffle,
  List,
  Layers,
  Check,
  Info,
  Trash2,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { PipelineStep, StepType, StepOption } from "./types";
import { stepOptions, stepColors, createStepFromOption, cloneStep } from "./types";

// Selection modes for OR generator - simplified to none/pick/arrange
type SelectionMode = "none" | "pick" | "arrange";

// Value can be a single number or a range [from, to]
type SelectionValue = number | [number, number];

interface SelectionConfig {
  mode: SelectionMode;
  value?: SelectionValue; // Single value or [from, to] range
}

// Check if value is a range
function isRange(value: SelectionValue | undefined): value is [number, number] {
  return Array.isArray(value) && value.length === 2;
}

const selectionModeLabels: Record<SelectionMode, { label: string; description: string }> = {
  none: {
    label: "Try Each",
    description: "Test each option individually",
  },
  pick: {
    label: "Pick",
    description: "Choose options (combinations, order doesn't matter)",
  },
  arrange: {
    label: "Arrange",
    description: "Choose options (permutations, order matters)",
  },
};

// Calculate combinations C(n, k)
function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

// Calculate permutations P(n, k)
function permutations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result *= n - i;
  }
  return result;
}

// Calculate variants for a selection value (single or range)
function calculateVariantsForValue(
  optionCount: number,
  mode: "pick" | "arrange",
  value: SelectionValue
): number {
  if (isRange(value)) {
    // Range [from, to]: sum of all variants from 'from' to 'to'
    const [from, to] = value;
    let total = 0;
    for (let k = from; k <= to; k++) {
      if (mode === "pick") {
        total += combinations(optionCount, k);
      } else {
        total += permutations(optionCount, k);
      }
    }
    return total;
  } else {
    // Single value
    if (mode === "pick") {
      return combinations(optionCount, value);
    } else {
      return permutations(optionCount, value);
    }
  }
}

// Calculate variant count based on selection mode
function calculateOrVariants(
  optionCount: number,
  selection: SelectionConfig
): number {
  switch (selection.mode) {
    case "none":
      return optionCount;
    case "pick":
      return calculateVariantsForValue(optionCount, "pick", selection.value || 1);
    case "arrange":
      return calculateVariantsForValue(optionCount, "arrange", selection.value || 1);
    default:
      return optionCount;
  }
}

/**
 * OrOptionItem - Individual option within an OR generator
 */
interface OrOptionItemProps {
  option: PipelineStep;
  index: number;
  isSelected?: boolean;
  isExpanded?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
  onToggleExpand?: () => void;
  onUpdate?: (updates: Partial<PipelineStep>) => void;
}

export function OrOptionItem({
  option,
  index,
  isSelected = false,
  isExpanded = false,
  onSelect,
  onRemove,
  onDuplicate,
  onToggleExpand,
  onUpdate,
}: OrOptionItemProps) {
  const colors = stepColors[option.type];

  return (
    <div
      className={cn(
        "group relative rounded-lg border transition-all",
        colors.border,
        colors.bg,
        isSelected && colors.selected,
        !isSelected && colors.hover
      )}
    >
      {/* Option Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={onSelect}
      >
        {/* Index indicator */}
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-background/50 text-xs font-mono text-muted-foreground">
          {index + 1}
        </div>

        {/* Option name */}
        <div className="flex-1 min-w-0">
          <span className={cn("font-medium text-sm", colors.text)}>
            {option.name}
          </span>
          {Object.keys(option.params).length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">
              ({Object.keys(option.params).length} params)
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onToggleExpand && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand();
                  }}
                >
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isExpanded ? "Collapse" : "Expand"} parameters
              </TooltipContent>
            </Tooltip>
          )}
          {onDuplicate && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate();
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Duplicate option</TooltipContent>
            </Tooltip>
          )}
          {onRemove && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove option</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Expanded Parameters */}
      {isExpanded && Object.keys(option.params).length > 0 && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/50">
          {Object.entries(option.params).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground capitalize flex-shrink-0 w-24">
                {key.replace(/_/g, " ")}
              </Label>
              <Input
                value={String(value)}
                onChange={(e) => {
                  if (!onUpdate) return;
                  const newValue =
                    typeof value === "number"
                      ? parseFloat(e.target.value) || 0
                      : typeof value === "boolean"
                      ? e.target.value === "true"
                      : e.target.value;
                  onUpdate({
                    params: { ...option.params, [key]: newValue },
                  });
                }}
                className="h-7 text-xs font-mono flex-1"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  step,
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

  // Calculate variant count
  const variantCount = useMemo(
    () => calculateOrVariants(options.length, selection),
    [options.length, selection]
  );

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
    const query = searchQuery.toLowerCase();
    const result: { type: StepType; options: StepOption[] }[] = [];

    (["preprocessing", "model", "splitting"] as StepType[]).forEach((type) => {
      const typeOptions = stepOptions[type].filter(
        (opt) =>
          opt.name.toLowerCase().includes(query) ||
          opt.description.toLowerCase().includes(query)
      );
      if (typeOptions.length > 0) {
        result.push({ type, options: typeOptions });
      }
    });

    return result;
  }, [searchQuery]);

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
              {options.length} option{options.length !== 1 ? "s" : ""} • {variantCount}{" "}
              variant{variantCount !== 1 ? "s" : ""}
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
              {Object.entries(selectionModeLabels).map(([mode, { label, description }]) => (
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
            {selection.mode === "pick" ? "Pick" : "Arrange"}
          </Label>
          {isRange(selection.value) ? (
            <>
              <Input
                type="number"
                min={1}
                max={selection.value[1]}
                value={selection.value[0]}
                onChange={(e) =>
                  onSelectionChange?.({
                    ...selection,
                    value: [Math.max(1, parseInt(e.target.value) || 1), selection.value[1]],
                  })
                }
                className="w-12 h-7 text-xs font-mono"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="number"
                min={selection.value[0]}
                max={options.length}
                value={selection.value[1]}
                onChange={(e) =>
                  onSelectionChange?.({
                    ...selection,
                    value: [selection.value[0], Math.max(selection.value[0], Math.min(options.length, parseInt(e.target.value) || selection.value[0]))],
                  })
                }
                className="w-12 h-7 text-xs font-mono"
              />
            </>
          ) : (
            <Input
              type="number"
              min={1}
              max={options.length}
              value={selection.value || 2}
              onChange={(e) =>
                onSelectionChange?.({
                  ...selection,
                  value: Math.max(1, Math.min(options.length, parseInt(e.target.value) || 2)),
                })
              }
              className="w-14 h-7 text-xs font-mono"
            />
          )}
          <Label className="text-xs text-muted-foreground">
            of {options.length}{" "}
            {selection.mode === "pick" ? "(combinations)" : "(permutations)"}
          </Label>
          <Badge variant="secondary" className="ml-auto text-xs">
            {variantCount} variant{variantCount !== 1 ? "s" : ""}
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
              options.length > 1 ? () => onRemoveOption?.(index) : undefined
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
  onDrop,
  className,
}: OrGeneratorDropZoneProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center p-4 rounded-lg border-2 border-dashed transition-all",
        isActive
          ? "border-orange-500 bg-orange-500/10"
          : "border-border/50 hover:border-orange-500/50 hover:bg-orange-500/5",
        className
      )}
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
  trigger?: React.ReactNode;
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
                  className={cn("text-xs", stepColors[step.type].text)}
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
              {variantCount} variant{variantCount !== 1 ? "s" : ""}
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
