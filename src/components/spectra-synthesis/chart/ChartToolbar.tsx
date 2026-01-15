/**
 * ChartToolbar - Controls for chart display options
 *
 * Features:
 * - Toggle mean line
 * - Toggle std band
 * - Auto-refresh toggle
 * - Generate preview button
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, Play, RefreshCw, TrendingUp, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChartToolbarProps {
  showMean: boolean;
  onShowMeanChange: (value: boolean) => void;
  showStdBand: boolean;
  onShowStdBandChange: (value: boolean) => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (value: boolean) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  canGenerate: boolean;
  hasErrors: boolean;
  className?: string;
}

export function ChartToolbar({
  showMean,
  onShowMeanChange,
  showStdBand,
  onShowStdBandChange,
  autoRefresh,
  onAutoRefreshChange,
  onGenerate,
  isGenerating,
  canGenerate,
  hasErrors,
  className,
}: ChartToolbarProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-3 py-2 border-b bg-background/80 backdrop-blur-sm",
        className
      )}
    >
      {/* Left side - display options */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5">
                <Switch
                  id="show-mean"
                  checked={showMean}
                  onCheckedChange={onShowMeanChange}
                  className="h-4 w-7"
                />
                <Label
                  htmlFor="show-mean"
                  className="text-xs cursor-pointer flex items-center gap-1"
                >
                  <TrendingUp className="h-3 w-3" />
                  Mean
                </Label>
              </div>
            </TooltipTrigger>
            <TooltipContent>Show mean spectrum line</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5">
                <Switch
                  id="show-std"
                  checked={showStdBand}
                  onCheckedChange={onShowStdBandChange}
                  className="h-4 w-7"
                />
                <Label
                  htmlFor="show-std"
                  className="text-xs cursor-pointer flex items-center gap-1"
                >
                  <Layers className="h-3 w-3" />
                  Std Band
                </Label>
              </div>
            </TooltipTrigger>
            <TooltipContent>Show standard deviation band</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Right side - generation controls */}
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              <Switch
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={onAutoRefreshChange}
                className="h-4 w-7"
              />
              <Label
                htmlFor="auto-refresh"
                className="text-xs cursor-pointer flex items-center gap-1"
              >
                <RefreshCw
                  className={cn("h-3 w-3", autoRefresh && "text-primary")}
                />
                Auto
              </Label>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            Auto-regenerate preview when configuration changes
          </TooltipContent>
        </Tooltip>

        <Button
          size="sm"
          onClick={onGenerate}
          disabled={isGenerating || !canGenerate || hasErrors}
          className="h-7 px-3 bg-teal-600 hover:bg-teal-700"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Generate
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
