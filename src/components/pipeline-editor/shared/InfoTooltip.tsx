/**
 * InfoTooltip - Reusable tooltip component for parameter help
 *
 * Provides consistent styling for info icons with tooltips throughout
 * the pipeline editor. Extracted from repeated patterns in StepConfigPanel.
 *
 * @example
 * <InfoTooltip content="Number of PLS components to use" />
 * <InfoTooltip content="Help text" side="right" iconClassName="text-primary" />
 */

import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface InfoTooltipProps {
  /** The tooltip content to display */
  content: React.ReactNode;
  /** Tooltip position relative to trigger */
  side?: "top" | "right" | "bottom" | "left";
  /** Alignment of the tooltip */
  align?: "start" | "center" | "end";
  /** Additional classes for the icon */
  iconClassName?: string;
  /** Custom icon size (default: h-3.5 w-3.5) */
  iconSize?: "sm" | "md" | "lg";
  /** Custom icon to use instead of Info */
  icon?: React.ReactNode;
  /** Max width of tooltip content (default: 200px) */
  maxWidth?: number;
  /** Whether the tooltip trigger should be a span (for inline) or div */
  inline?: boolean;
}

const iconSizes = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
};

export function InfoTooltip({
  content,
  side = "left",
  align = "center",
  iconClassName,
  iconSize = "md",
  icon,
  maxWidth = 200,
  inline = true,
}: InfoTooltipProps) {
  const Wrapper = inline ? "span" : "div";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Wrapper className="cursor-help inline-flex items-center">
          {icon ?? (
            <Info
              className={cn(
                iconSizes[iconSize],
                "text-muted-foreground",
                iconClassName
              )}
            />
          )}
        </Wrapper>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        className={cn("max-w-[var(--tooltip-max-width)]")}
        style={{ "--tooltip-max-width": `${maxWidth}px` } as React.CSSProperties}
      >
        {typeof content === "string" ? <p>{content}</p> : content}
      </TooltipContent>
    </Tooltip>
  );
}
