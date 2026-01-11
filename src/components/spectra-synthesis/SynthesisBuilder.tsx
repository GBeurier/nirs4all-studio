/**
 * SynthesisBuilder - Center panel showing the builder chain
 *
 * Displays:
 * - Core config card at top
 * - Chain of added steps with connectors
 * - Build step at bottom
 */

import { useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Play, AlertTriangle, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSynthesisBuilder } from "./contexts";
import { CoreConfigCard } from "./CoreConfigCard";
import { SynthesisStepCard } from "./SynthesisStepCard";
import { ChainConnector } from "./ChainConnector";
import type { SynthesisStep } from "./types";
import { cn } from "@/lib/utils";

interface SynthesisBuilderProps {
  className?: string;
  onGenerate?: () => void;
  isGenerating?: boolean;
}

export function SynthesisBuilder({
  className,
  onGenerate,
  isGenerating,
}: SynthesisBuilderProps) {
  const { state, reorderSteps } = useSynthesisBuilder();
  const { steps, errors, warnings } = state;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = steps.findIndex((s) => s.id === active.id);
      const newIndex = steps.findIndex((s) => s.id === over.id);
      reorderSteps(oldIndex, newIndex);
    }
  };

  const enabledStepsCount = useMemo(
    () => steps.filter((s) => s.enabled).length,
    [steps]
  );

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Builder Chain</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {enabledStepsCount} step{enabledStepsCount !== 1 ? "s" : ""} configured
            </p>
          </div>
          <Button
            size="sm"
            onClick={onGenerate}
            disabled={isGenerating || errors.length > 0}
          >
            {isGenerating ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent mr-2" />
                Generating...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Generate Preview
              </>
            )}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {/* Validation errors */}
          {errors.length > 0 && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {errors.map((e, i) => (
                  <div key={i}>{e.message}</div>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {/* Validation warnings */}
          {warnings.length > 0 && (
            <Alert className="mb-4 border-yellow-500/50 bg-yellow-500/10">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-yellow-700 dark:text-yellow-400">
                {warnings.map((w, i) => (
                  <div key={i}>{w.message}</div>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {/* Core config */}
          <CoreConfigCard />

          {/* Builder chain */}
          {steps.length > 0 && (
            <>
              <ChainConnector />

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={steps.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {steps.map((step, index) => (
                    <div key={step.id}>
                      <SortableStepCard step={step} />
                      {index < steps.length - 1 && <ChainConnector />}
                    </div>
                  ))}
                </SortableContext>
              </DndContext>
            </>
          )}

          {/* Build step */}
          <ChainConnector />
          <BuildCard enabledStepsCount={enabledStepsCount} />
        </div>
      </ScrollArea>
    </div>
  );
}

// Sortable wrapper for step cards
interface SortableStepCardProps {
  step: SynthesisStep;
}

function SortableStepCard({ step }: SortableStepCardProps) {
  const { state } = useSynthesisBuilder();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <SynthesisStepCard
        step={step}
        isSelected={state.selectedStepId === step.id}
        isDragging={isDragging}
        dragHandleProps={listeners}
      />
    </div>
  );
}

// Build card at the bottom
interface BuildCardProps {
  enabledStepsCount: number;
}

function BuildCard({ enabledStepsCount }: BuildCardProps) {
  return (
    <Card className="border-dashed border-2 bg-muted/30">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <Play className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium">.build()</h4>
              <Badge variant="outline" className="text-xs">
                {enabledStepsCount} steps
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Generate synthetic dataset
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
