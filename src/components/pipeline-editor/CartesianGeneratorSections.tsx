/**
 * CartesianGeneratorSections - Presentational pieces for the cartesian generator
 *
 * These are the repetitive visual sections extracted out of
 * `CartesianGenerator.tsx` so the public components stay thin orchestrators.
 * All formatting/combinatoric rules live in `CartesianGeneratorData.ts`.
 */

import { useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Grid,
  Info,
  LayoutGrid,
  Plus,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getStepColor, stepColors } from "./stepPresentation";
import { useStepMetadataCatalog } from "./shared/stepMetadata";
import type { PipelineStep, StepOption, StepType } from "./types";
import {
  CARTESIAN_PICKER_OPTIONS_PER_TYPE,
  getCartesianStepOptionGroups,
  getCartesianSummary,
  getCartesianVariantBadgeClassName,
  getRemainingCombinationsCount,
  hasMoreCombinations,
} from "./CartesianGeneratorData";

/** A single removable option chip inside a stage. */
export function StageOptionChip({
  option,
  canRemove,
  onRemove,
}: {
  option: PipelineStep;
  canRemove: boolean;
  onRemove?: () => void;
}) {
  const colors = getStepColor(option);
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm",
        colors.border,
        colors.bg,
      )}
    >
      <span className={colors.text}>{option.name}</span>
      {canRemove && onRemove && (
        <Button
          variant="ghost"
          size="sm"
          className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

/** Searchable popover used to add an option to a stage. */
export function StageOptionPicker({
  onAddOption,
}: {
  onAddOption: (type: StepType, option: StepOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { getStepOptions } = useStepMetadataCatalog();

  const groups = useMemo(
    () => getCartesianStepOptionGroups(searchQuery, getStepOptions),
    [searchQuery, getStepOptions],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 border-dashed border-cyan-500/50 text-cyan-500 hover:bg-cyan-500/10"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2 bg-popover">
        <Input
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="mb-2 h-7 text-xs"
        />
        <ScrollArea className="h-48">
          {groups.map(({ type, options }) => (
            <div key={type} className="mb-2">
              <div className="text-xs font-medium text-muted-foreground px-2 py-1 capitalize">
                {type}
              </div>
              {options.slice(0, CARTESIAN_PICKER_OPTIONS_PER_TYPE).map((opt) => (
                <Button
                  key={opt.name}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs h-7"
                  onClick={() => {
                    onAddOption(type, opt);
                    setOpen(false);
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
  );
}

/** Vertical connector arrow rendered between consecutive stages. */
export function StageConnector() {
  return (
    <div className="flex justify-center py-1">
      <ArrowRight className="h-4 w-4 text-cyan-500/50 rotate-90" />
    </div>
  );
}

/** Title + variant badge at the top of the generator container. */
export function CartesianContainerHeader({
  stageCount,
  baseCombinations,
  totalVariants,
}: {
  stageCount: number;
  baseCombinations: number;
  totalVariants: number;
}) {
  const summary = getCartesianSummary(stageCount, baseCombinations, totalVariants);

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-cyan-500/20">
          <LayoutGrid className="h-4 w-4 text-cyan-500" />
        </div>
        <div>
          <h4 className="font-medium text-sm text-cyan-600">
            Cartesian (_cartesian_)
          </h4>
          <p className="text-xs text-muted-foreground">
            {summary.stages} - {summary.baseCombinations}
            {summary.generatedVariants && <> - {summary.generatedVariants}</>}
          </p>
        </div>
      </div>

      <Badge
        variant="secondary"
        className={cn(
          "text-sm font-bold",
          getCartesianVariantBadgeClassName(totalVariants),
        )}
      >
        {totalVariants.toLocaleString()} pipelines
      </Badge>
    </div>
  );
}

/** Collapsible list of concrete combination examples. */
export function CartesianCombinationPreview({
  examples,
  baseCombinations,
}: {
  examples: string[][];
  baseCombinations: number;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full text-xs">
          <Grid className="h-3.5 w-3.5 mr-1" />
          Preview Combinations
          <ChevronDown className="h-3.5 w-3.5 ml-1" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 p-3 rounded-lg bg-background/50 space-y-1.5">
          {examples.map((combo, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 text-xs font-mono"
            >
              <span className="text-muted-foreground w-4">{idx + 1}.</span>
              {combo.map((step, stepIdx) => (
                <span key={stepIdx} className="flex items-center">
                  {stepIdx > 0 && (
                    <ArrowRight className="h-3 w-3 mx-1 text-muted-foreground" />
                  )}
                  <Badge variant="outline" className="text-xs py-0">
                    {step}
                  </Badge>
                </span>
              ))}
            </div>
          ))}
          {hasMoreCombinations(baseCombinations) && (
            <p className="text-xs text-muted-foreground pt-1">
              ...and {getRemainingCombinationsCount(baseCombinations)} more
              combinations
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Static explanatory note at the bottom of the generator container. */
export function CartesianInfoNote() {
  return (
    <div className="flex items-start gap-2 p-2 rounded-lg bg-background/50 text-xs text-muted-foreground">
      <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
      <span>
        Generates all combinations across stages. Each stage can have multiple
        options; one from each stage is selected per pipeline variant.
      </span>
    </div>
  );
}
