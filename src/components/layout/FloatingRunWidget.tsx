/**
 * FloatingRunWidget - Floating widget for monitoring active runs
 *
 * Shows a small floating panel when there are active runs.
 * Can be minimized to just an icon, or expanded to show progress details.
 * Clicking opens the full RunProgress page.
 */

import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress, IndeterminateProgress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronDown,
  Loader2,
  ExternalLink,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useActiveRuns } from "@/context/useActiveRuns";
import { useElapsedSeconds } from "@/hooks/useElapsedSeconds";
import { formatElapsedClock } from "@/lib/runs/format";
import {
  buildFloatingRunWidgetReadModel,
  buildRunItemReadModel,
  type FloatingRunWidgetRunItemReadModel,
} from "./FloatingRunWidgetData";

function RunItem({
  item,
  onClick,
}: {
  item: FloatingRunWidgetRunItemReadModel;
  onClick: () => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={cn(
        "w-full p-2 rounded-md cursor-pointer text-left transition-colors",
        item.containerClassName
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium truncate max-w-[150px]">
          {item.runName}
        </span>
        <Badge variant="outline" className="text-[10px]">
          {item.progressLabel ?? t("runs.widget.unavailable")}
        </Badge>
      </div>
      {item.progressUnavailable
        ? <IndeterminateProgress className="h-1.5" />
        : <Progress value={item.progress} className="h-1.5" />}
      <p className="text-[10px] text-muted-foreground mt-1 truncate">
        {item.message}
      </p>
    </button>
  );
}

export function FloatingRunWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    activeRuns,
    hasActiveRuns,
    isMinimized,
    toggleMinimized,
    selectedRunId,
    selectRun,
  } = useActiveRuns();

  const widgetData = buildFloatingRunWidgetReadModel({
    pathname: location.pathname,
    hasActiveRuns,
    activeRuns,
    selectedRunId,
  });

  const { selectedRun } = widgetData;
  const elapsedSeconds = useElapsedSeconds(selectedRun?.startedAt, widgetData.isVisible && !isMinimized);

  if (!widgetData.isVisible) {
    return null;
  }

  const selectedItem = selectedRun ? buildRunItemReadModel(selectedRun, true) : undefined;

  // Minimized view - just a small indicator
  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          variant="default"
          className="rounded-full h-12 w-12 p-0 shadow-lg relative"
          onClick={toggleMinimized}
          aria-label={t("runs.widget.expand", { count: widgetData.minimizedBadgeCount })}
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          {/* Count badge */}
          <span className="absolute -top-1 -right-1 bg-chart-2 text-white text-[10px] rounded-full h-5 w-5 flex items-center justify-center font-medium">
            {widgetData.minimizedBadgeCount}
          </span>
        </Button>
      </div>
    );
  }

  // Expanded view
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Card className="w-80 shadow-xl border-chart-2/30">
        {/* Header */}
        <CardHeader className="p-3 pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-chart-2" />
              {t("runs.widget.title")}
              <Badge variant="secondary" className="text-[10px]">
                {widgetData.minimizedBadgeCount}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={toggleMinimized}
                aria-label={t("runs.widget.minimize")}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-3 pt-0 space-y-3">
          {/* Multi-run selector (if more than one run) */}
          {widgetData.showRunSelector && (
            <ScrollArea className="h-24">
              <div className="space-y-1">
                {widgetData.runItems.map((item) => (
                  <RunItem
                    key={item.runId}
                    item={item}
                    onClick={() => selectRun(item.runId)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Selected run details */}
          {selectedRun && (
            <div className="space-y-2">
              {widgetData.showSingleRunSummary && (
                <div>
                  <p className="text-sm font-medium">{selectedRun.runName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {selectedRun.message}
                  </p>
                </div>
              )}

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{t("runs.widget.progress")}</span>
                  <span className="font-medium">{selectedItem?.progressLabel ?? t("runs.widget.unavailable")}</span>
                </div>
                {selectedItem?.progressUnavailable
                  ? <IndeterminateProgress className="h-2" />
                  : <Progress value={selectedRun.progress} className="h-2" />}
                {elapsedSeconds != null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{t("runs.widget.elapsed")}</span>
                    <span className="font-mono font-medium tabular-nums">{formatElapsedClock(elapsedSeconds)}</span>
                  </div>
                )}
              </div>

              {/* Recent logs (last 3) */}
              {widgetData.showRecentLogs && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Terminal className="h-3 w-3" />
                    {t("runs.widget.recentLogs")}
                  </div>
                  <div className="bg-muted/50 rounded p-1.5 font-mono text-[10px] space-y-0.5 max-h-16 overflow-hidden">
                    {widgetData.recentLogs.map((log, i) => (
                      <div key={i} className="truncate text-muted-foreground">
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Open full view button */}
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => widgetData.detailPath && navigate(widgetData.detailPath)}
              >
                <ExternalLink className="h-3 w-3 mr-1.5" />
                {t("runs.actions.view")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
