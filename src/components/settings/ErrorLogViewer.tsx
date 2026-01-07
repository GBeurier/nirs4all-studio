/**
 * Error Log Viewer Component
 *
 * Displays recent error logs for debugging purposes.
 * Only shown in developer mode.
 *
 * Features:
 * - List of recent errors with timestamps
 * - Error level indicators (error, warning, critical)
 * - Expandable details and traceback
 * - Clear logs functionality
 * - Copy error details
 *
 * Phase 5: System Information & Diagnostics
 */

import { useState, useEffect } from "react";
import {
  AlertTriangle,
  AlertCircle,
  AlertOctagon,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  FileWarning,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getErrorLogs, clearErrorLogs } from "@/api/client";
import type { ErrorLogEntry, ErrorLogResponse } from "@/types/settings";
import { formatRelativeTime } from "@/utils/formatters";

interface ErrorLogViewerProps {
  /** Maximum number of errors to display */
  limit?: number;
  /** Whether to auto-refresh */
  autoRefresh?: boolean;
  /** Auto-refresh interval in seconds */
  refreshInterval?: number;
}

interface ErrorItemProps {
  error: ErrorLogEntry;
  onCopy: () => void;
}

function ErrorItem({ error, onCopy }: ErrorItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const getLevelIcon = () => {
    switch (error.level) {
      case "critical":
        return <AlertOctagon className="h-4 w-4 text-destructive" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getLevelBadgeVariant = () => {
    switch (error.level) {
      case "critical":
        return "destructive";
      case "error":
        return "destructive";
      case "warning":
        return "outline";
    }
  };

  const handleCopy = async () => {
    const text = `
Error: ${error.message}
Level: ${error.level}
Endpoint: ${error.endpoint}
Time: ${error.timestamp}
${error.details ? `\nDetails: ${error.details}` : ""}
${error.traceback ? `\nTraceback:\n${error.traceback}` : ""}
`.trim();

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopy();
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border rounded-lg">
        <CollapsibleTrigger asChild>
          <div className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="mt-0.5">{getLevelIcon()}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant={getLevelBadgeVariant() as "destructive" | "outline"} className="text-xs">
                  {error.level}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {error.endpoint}
                </span>
              </div>
              <p className="text-sm truncate">{error.message}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatRelativeTime(error.timestamp)}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopy();
                }}
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t p-3 space-y-3 bg-muted/30">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Full Message
              </p>
              <p className="text-sm">{error.message}</p>
            </div>
            {error.details && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Details
                </p>
                <p className="text-sm text-muted-foreground">{error.details}</p>
              </div>
            )}
            {error.traceback && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Traceback
                </p>
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-48">
                  {error.traceback}
                </pre>
              </div>
            )}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>ID: {error.id}</span>
              <span>{new Date(error.timestamp).toLocaleString()}</span>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function ErrorLogViewer({
  limit = 50,
  autoRefresh = false,
  refreshInterval = 60,
}: ErrorLogViewerProps) {
  const [logData, setLogData] = useState<ErrorLogResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const loadLogs = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getErrorLogs(limit);
      setLogData(data);
    } catch (err) {
      // If endpoint doesn't exist, show empty state instead of error
      if ((err as { status?: number }).status === 404) {
        setLogData({ errors: [], total: 0, max_stored: 100 });
      } else {
        setError(err instanceof Error ? err.message : "Failed to load error logs");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearLogs = async () => {
    try {
      setIsClearing(true);
      await clearErrorLogs();
      setLogData({ errors: [], total: 0, max_stored: logData?.max_stored ?? 100 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear logs");
    } finally {
      setIsClearing(false);
    }
  };

  useEffect(() => {
    loadLogs();

    if (autoRefresh) {
      const interval = setInterval(loadLogs, refreshInterval * 1000);
      return () => clearInterval(interval);
    }
  }, [limit, autoRefresh, refreshInterval]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileWarning className="h-5 w-5" />
            Error Log
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <FileWarning className="h-5 w-5" />
            Error Log
          </CardTitle>
          <CardDescription className="text-destructive">
            {error}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={loadLogs}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const errors = logData?.errors ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5" />
              Error Log
              {errors.length > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {errors.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Recent errors for debugging ({logData?.total ?? 0} total, max{" "}
              {logData?.max_stored ?? 100} stored)
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={loadLogs}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            {errors.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" disabled={isClearing}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear Error Logs?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will clear all {errors.length} error log entries.
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearLogs}>
                      Clear All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {errors.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileWarning className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No errors logged</p>
            <p className="text-xs mt-1">
              Errors will appear here when they occur
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-2">
              {errors.map((err) => (
                <ErrorItem
                  key={err.id}
                  error={err}
                  onCopy={() => {}}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
