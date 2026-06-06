import { useEffect, useRef } from "react";

import { Download, Terminal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { parseLogContext } from "./runProgressLogs";

export function LogsPanel({
  logs,
  isLive,
  isLoading,
  errorMessage,
  onRefresh,
  onExport,
}: {
  logs: string[];
  isLive?: boolean;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRefresh?: () => void;
  onExport?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current && isLive) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isLive]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          Logs
          {isLive && (
            <Badge variant="outline" className="text-[10px] text-chart-2 border-chart-2/50 animate-pulse">
              Live
            </Badge>
          )}
          {isLoading && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Loading
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            {onExport && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px]"
                onClick={onExport}
                disabled={logs.length === 0}
              >
                <Download className="h-3 w-3 mr-1" />
                Export
              </Button>
            )}
            <span className="text-[10px] text-muted-foreground font-normal">
              {logs.length} entries
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {errorMessage && (
          <div className="mb-2 text-xs text-destructive flex items-center justify-between">
            <span>{errorMessage}</span>
            {onRefresh && (
              <Button variant="ghost" size="sm" onClick={onRefresh}>
                Retry
              </Button>
            )}
          </div>
        )}
        <ScrollArea className="h-64" ref={scrollRef}>
          <div className="font-mono text-xs space-y-0.5">
            {logs.length === 0 ? (
              <div className="text-muted-foreground">Waiting for logs...</div>
            ) : (
              logs.map((log, i) => {
                const context = parseLogContext(log);
                const hasContext = context.foldInfo || context.branchInfo || context.variantInfo;

                return (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-1",
                      log.includes("[ERROR]") && "text-destructive",
                      log.includes("[WARN]") && "text-amber-500",
                      log.includes("[INFO]") && "text-muted-foreground"
                    )}
                  >
                    {/* Context badges */}
                    {hasContext && (
                      <span className="flex gap-0.5 shrink-0">
                        {context.foldInfo && (
                          <span className="px-1 py-0.5 rounded text-[9px] bg-cyan-500/10 text-cyan-600">
                            {context.foldInfo}
                          </span>
                        )}
                        {context.branchInfo && (
                          <span className="px-1 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-600 max-w-[60px] truncate">
                            {context.branchInfo}
                          </span>
                        )}
                        {context.variantInfo && (
                          <span className="px-1 py-0.5 rounded text-[9px] bg-violet-500/10 text-violet-600">
                            {context.variantInfo}
                          </span>
                        )}
                      </span>
                    )}
                    <span className="truncate">{log}</span>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
