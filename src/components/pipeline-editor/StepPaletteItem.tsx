import { useDraggable } from "@dnd-kit/core";
import {
  GripVertical,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { motion } from "@/lib/motion";
import {
  stepColors,
} from "./stepPresentation";
import { stepIcons } from "./StepPaletteIcons";
import type {
  StepOption,
  StepType,
} from "./types";
import { usePipelineDnd } from "./usePipelineDnd";

interface DraggableStepProps {
  stepType: StepType;
  option: StepOption;
  onDoubleClick: () => void;
  isCompact?: boolean;
  isUnavailable?: boolean;
  unavailableReason?: string;
}

export function DraggableStep({
  stepType,
  option,
  onDoubleClick,
  isCompact = false,
  isUnavailable = false,
  unavailableReason,
}: DraggableStepProps) {
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
            ${isUnavailable ? "border-dashed border-amber-500/60 bg-amber-50/70 opacity-75 dark:bg-amber-950/20" : ""}
          `}
        >
          <GripVertical className="h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
          <div className={`p-1 rounded ${colors.bg} ${colors.text} flex-shrink-0`}>
            <Icon className="h-3 w-3" />
          </div>
          <div className="min-w-0 flex-1 w-0">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium text-foreground truncate">{option.name}</p>
              {isUnavailable && (
                <Badge variant="outline" className="h-4 px-1 text-[9px] text-amber-700 border-amber-500/50 dark:text-amber-300">
                  Unavailable
                </Badge>
              )}
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
          {isUnavailable && unavailableReason && (
            <div className="rounded-md border border-amber-500/30 bg-amber-50 px-2 py-1 text-[10px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
              {unavailableReason}
            </div>
          )}
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
