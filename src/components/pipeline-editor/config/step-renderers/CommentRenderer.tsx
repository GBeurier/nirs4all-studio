/**
 * CommentRenderer - Comment step configuration renderer
 *
 * Renderer for non-functional documentation comment steps.
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StepActions } from "./StepActions";
import type { StepRendererProps } from "./types";

/**
 * CommentRenderer - Pipeline documentation/annotation
 */
export function CommentRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
}: StepRendererProps) {
  const { t } = useTranslation();
  const handleTextChange = (text: string) => {
    onUpdate(step.id, {
      params: { ...step.params, text },
    });
  };

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-500/10 border border-gray-500/30">
            <MessageSquare className="h-5 w-5 text-gray-500" />
            <div>
              <h4 className="font-medium text-sm">{t("pipelineEditor.config.comment.title")}</h4>
              <p className="text-xs text-muted-foreground">
                {t("pipelineEditor.config.comment.subtitle")}
              </p>
            </div>
          </div>

          {/* Comment Text */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("pipelineEditor.config.comment.textLabel")}</Label>
            <textarea
              value={String(step.params.text || "")}
              onChange={(e) => handleTextChange(e.target.value)}
              className="w-full min-h-[120px] p-3 rounded-md border bg-background text-sm resize-y"
              placeholder={t("pipelineEditor.config.comment.placeholder")}
            />
            <p className="text-xs text-muted-foreground">
              {t("pipelineEditor.config.comment.exportNote")}
            </p>
          </div>
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
