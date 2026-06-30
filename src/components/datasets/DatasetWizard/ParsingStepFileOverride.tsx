/**
 * Per-file override row.
 *
 * Pure presentation: a collapsible row showing a file's name, shape badge, and
 * an override toggle. When override is enabled it reveals the compact parsing
 * form and an optional auto-detect button. All state changes are reported
 * through callbacks; the parent owns detection and wizard dispatch.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Wand2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ParsingForm } from "./ParsingStepForm";
import type { ParsingOptions } from "@/types/datasets";

export interface FileOverrideRowProps {
  filename: string;
  path: string;
  hasOverride: boolean;
  overrides: Partial<ParsingOptions>;
  onToggle: () => void;
  onChange: (updates: Partial<ParsingOptions>) => void;
  onAutoDetect?: () => Promise<void>;
  shape?: { rows: number; cols: number };
  isDetecting?: boolean;
}

export function FileOverrideRow({
  filename,
  path,
  hasOverride,
  overrides,
  onToggle,
  onChange,
  onAutoDetect,
  shape,
  isDetecting,
}: FileOverrideRowProps) {
  const [expanded, setExpanded] = useState(false);

  // Auto-expand when override is enabled
  const handleToggle = () => {
    if (!hasOverride) {
      // Enabling override - expand the row
      setExpanded(true);
    }
    onToggle();
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="border-b last:border-0">
        <div className="flex items-center gap-3 p-3 hover:bg-muted/30">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </Button>
          </CollapsibleTrigger>

          <span className="text-sm flex-1 truncate" title={path}>
            {filename}
          </span>

          {shape && (
            <Badge variant="outline" className="text-xs font-mono">
              {shape.rows} x {shape.cols}
            </Badge>
          )}

          {hasOverride && (
            <Badge variant="secondary" className="text-xs">
              Custom
            </Badge>
          )}

          <Switch
            checked={hasOverride}
            onCheckedChange={handleToggle}
            className="ml-2"
          />
        </div>

        <CollapsibleContent>
          {hasOverride && (
            <div className="px-3 pb-3 pt-1 ml-9 bg-muted/20 rounded-b-md space-y-2">
              {onAutoDetect && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onAutoDetect}
                    disabled={isDetecting}
                    className="h-7 text-xs"
                  >
                    {isDetecting ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Wand2 className="h-3 w-3 mr-1" />
                    )}
                    Auto-detect
                  </Button>
                </div>
              )}
              <ParsingForm options={overrides} onChange={onChange} compact />
            </div>
          )}
          {!hasOverride && expanded && (
            <div className="px-3 pb-3 pt-1 ml-9 text-sm text-muted-foreground">
              Using global settings. Enable override to customize.
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
