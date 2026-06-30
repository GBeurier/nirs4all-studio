/**
 * HelpSystem - Inline help and documentation components.
 *
 * Phase 6 Implementation:
 * - Contextual tooltips with operator descriptions
 * - Parameter documentation with examples
 * - "What's This?" mode for interactive help
 * - Quick links to documentation
 */

import { type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  HelpCircle,
  ExternalLink,
  Lightbulb,
  BookOpen,
  Code,
  Info,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getOperatorHelp } from "./helpContent";
import { HelpModeProvider } from "./HelpModeProvider";
import { useHelpMode } from "./useHelpMode";

// ============================================================================
// Components
// ============================================================================

/** Simple inline help icon with tooltip */
export function HelpTooltip({
  content,
  children,
  side = "top",
}: {
  content: string;
  children?: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          {children || (
            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground cursor-help" />
          )}
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-[300px]">
          <p className="text-sm">{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Parameter help tooltip with type and range info */
export function ParameterHelp({
  paramName,
  operatorName,
}: {
  paramName: string;
  operatorName: string;
}) {
  const help = getOperatorHelp(operatorName);
  const paramHelp = help?.parameters?.[paramName];

  if (!paramHelp) {
    return <HelpTooltip content={`Parameter: ${paramName}`} />;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex">
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground cursor-help" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">{paramName}</span>
            <Badge variant="outline" className="text-xs">
              {paramHelp.type}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {paramHelp.description}
          </p>

          {paramHelp.default !== undefined && (
            <div className="text-xs">
              <span className="text-muted-foreground">Default: </span>
              <code className="bg-muted px-1 py-0.5 rounded">
                {String(paramHelp.default)}
              </code>
            </div>
          )}

          {paramHelp.range && (
            <div className="text-xs">
              <span className="text-muted-foreground">Range: </span>
              <code className="bg-muted px-1 py-0.5 rounded">
                {paramHelp.range.min} – {paramHelp.range.max}
              </code>
            </div>
          )}

          {paramHelp.options && (
            <div className="text-xs">
              <span className="text-muted-foreground">Options: </span>
              {paramHelp.options.map((opt) => (
                <code key={opt} className="bg-muted px-1 py-0.5 rounded mr-1">
                  {opt}
                </code>
              ))}
            </div>
          )}

          {paramHelp.tip && (
            <div className="flex items-start gap-2 mt-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded p-2">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
              <span>{paramHelp.tip}</span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Operator help card with full documentation */
export function OperatorHelpCard({
  operatorName,
  onClose,
}: {
  operatorName: string;
  onClose?: () => void;
}) {
  const help = getOperatorHelp(operatorName);

  if (!help) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium">{operatorName}</span>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          No documentation available for this operator.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">{help.displayName}</h3>
            <Badge variant="secondary" className="mt-1">
              {help.category}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {help.docUrl && (
              <Button variant="ghost" size="sm" asChild>
                <a href={help.docUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Docs
                </a>
              </Button>
            )}
            {onClose && (
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <ScrollArea className="max-h-[400px]">
        <div className="p-4 space-y-4">
          <p className="text-sm">{help.longDescription || help.description}</p>

          {/* Parameters */}
          {help.parameters && Object.keys(help.parameters).length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Code className="h-4 w-4" />
                Parameters
              </h4>
              <div className="space-y-3">
                {Object.entries(help.parameters).map(([name, param]) => (
                  <div key={name} className="rounded border p-2">
                    <div className="flex items-center justify-between">
                      <code className="text-sm font-medium">{name}</code>
                      <Badge variant="outline" className="text-xs">
                        {param.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {param.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Examples */}
          {help.examples && help.examples.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                Examples
              </h4>
              <div className="space-y-1">
                {help.examples.map((example, i) => (
                  <code
                    key={i}
                    className="block text-xs bg-muted p-2 rounded font-mono"
                  >
                    {example}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Tips */}
          {help.tips && help.tips.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                Tips
              </h4>
              <ul className="text-xs space-y-1 list-disc list-inside text-muted-foreground">
                {help.tips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          )}

          {/* See Also */}
          {help.seeAlso && help.seeAlso.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">See Also</h4>
              <div className="flex flex-wrap gap-1">
                {help.seeAlso.map((name) => (
                  <Badge key={name} variant="secondary" className="text-xs">
                    {name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/** "What's This?" mode toggle button */
export function WhatsThisButton() {
  const { helpModeActive, toggleHelpMode } = useHelpMode();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={helpModeActive ? "default" : "outline"}
            size="sm"
            onClick={toggleHelpMode}
            className={cn(
              "gap-2",
              helpModeActive && "bg-amber-500 hover:bg-amber-600"
            )}
          >
            <Sparkles className="h-4 w-4" />
            {helpModeActive ? "Help Mode ON" : "What's This?"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Click any operator to see its documentation</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Help panel that shows when operator is clicked in help mode */
export function OperatorHelpPanel() {
  const { activeOperator, clearActiveOperator } = useHelpMode();

  if (!activeOperator) return null;

  return (
    <div className="fixed bottom-4 right-4 w-96 z-50 shadow-xl">
      <OperatorHelpCard
        operatorName={activeOperator}
        onClose={clearActiveOperator}
      />
    </div>
  );
}

/** Inline info callout for contextual tips */
export function InfoCallout({
  children,
  type = "info",
}: {
  children: ReactNode;
  type?: "info" | "tip" | "warning";
}) {
  const styles = {
    info: "bg-blue-500/10 border-blue-500/20 text-blue-600",
    tip: "bg-amber-500/10 border-amber-500/20 text-amber-600",
    warning: "bg-red-500/10 border-red-500/20 text-red-600",
  };

  const icons = {
    info: Info,
    tip: Lightbulb,
    warning: Info,
  };

  const Icon = icons[type];

  return (
    <div
      className={cn(
        "flex items-start gap-2 text-xs border rounded p-2",
        styles[type]
      )}
    >
      <Icon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export default {
  HelpTooltip,
  ParameterHelp,
  OperatorHelpCard,
  WhatsThisButton,
  OperatorHelpPanel,
  InfoCallout,
  HelpModeProvider,
  useHelpMode,
  getOperatorHelp,
};
