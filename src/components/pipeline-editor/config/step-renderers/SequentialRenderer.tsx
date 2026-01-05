/**
 * SequentialRenderer - Sequential step group configuration renderer
 *
 * Provides UI for configuring sequential container steps that group
 * preprocessing steps to execute in order (equivalent to [...] in nirs4all).
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { Layers, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Trash2 } from "lucide-react";
import { StepActions } from "./StepActions";
import type { StepRendererProps } from "./types";
import type { PipelineStep } from "../../types";

/**
 * SequentialRenderer - Configuration UI for sequential step groups
 *
 * Sequential groups execute their children in order, allowing nested
 * pipelines inside augmentation, feature augmentation, etc.
 */
export function SequentialRenderer({
  step,
  onRemove,
  onDuplicate,
  onSelectStep,
  onAddChild,
  onRemoveChild,
}: StepRendererProps) {
  const children = step.children ?? [];

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-lime-500/10 border border-lime-500/30">
            <Layers className="h-5 w-5 text-lime-500" />
            <div className="flex-1">
              <h4 className="font-medium text-sm">Sequential Group</h4>
              <p className="text-xs text-muted-foreground">
                Steps execute in order, top to bottom
              </p>
            </div>
            <Badge
              variant="secondary"
              className="bg-lime-500/20 text-lime-600"
            >
              {children.length} step{children.length !== 1 ? "s" : ""}
            </Badge>
          </div>

          <Separator />

          {/* Description */}
          <div className="text-sm text-muted-foreground">
            <p>
              A sequential group packages multiple steps into a single unit.
              This is equivalent to wrapping steps in <code className="text-xs bg-muted px-1 py-0.5 rounded">[...]</code> in nirs4all.
            </p>
            <p className="mt-2">
              Use this to create reusable preprocessing pipelines or to nest
              sequences inside augmentation containers.
            </p>
          </div>

          <Separator />

          {/* Children List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Steps ({children.length})
              </Label>
              {onAddChild && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs border-lime-500/50 text-lime-600 hover:bg-lime-500/10"
                  onClick={() => onAddChild(step.id)}
                >
                  <Layers className="h-3 w-3 mr-1" />
                  Add Step
                </Button>
              )}
            </div>

            {children.length > 0 ? (
              <div className="space-y-1">
                {children.map((child, i) => (
                  <div key={child.id}>
                    <div
                      className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border hover:bg-muted/70 cursor-pointer group"
                      onClick={() => onSelectStep?.(child.id)}
                    >
                      <Badge variant="secondary" className="text-xs font-mono w-6 h-6 flex items-center justify-center p-0">
                        {i + 1}
                      </Badge>
                      <span className="text-sm font-medium flex-1">{child.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {Object.keys(child.params || {}).length > 0 &&
                          `(${Object.entries(child.params)
                            .slice(0, 2)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(", ")})`}
                      </span>
                      {onRemoveChild && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveChild(step.id, child.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    {i < children.length - 1 && (
                      <div className="flex justify-center py-1">
                        <ArrowDown className="h-3 w-3 text-muted-foreground/50" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="text-center py-6 border border-dashed border-lime-500/30 rounded-lg hover:border-lime-500/50 hover:bg-lime-500/5 cursor-pointer transition-colors"
                onClick={() => onAddChild?.(step.id)}
              >
                <Layers className="h-8 w-8 text-lime-500/50 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No steps in sequence</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Click to add preprocessing or transform steps
                </p>
              </div>
            )}
          </div>

          {/* Usage hint */}
          {children.length > 0 && (
            <>
              <Separator />
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                <ArrowDown className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  Steps execute sequentially. The output of each step becomes
                  the input for the next.
                </span>
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      <StepActions
        stepId={step.id}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </>
  );
}
