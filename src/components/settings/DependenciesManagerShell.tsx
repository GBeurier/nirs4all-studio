import type { ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Package,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatLastActionText,
  type LastActionState,
} from "./DependenciesManagerLogic";
import type { DependenciesResponse } from "@/api/dependencies";
import type { PythonRuntimeDisplayState } from "@/lib/pythonRuntimeDisplay";

interface DependenciesLoadingCardProps {
  title?: string;
}

export function DependenciesLoadingCard({
  title = "Optional Dependencies",
}: DependenciesLoadingCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </CardContent>
    </Card>
  );
}

interface DependenciesErrorCardProps {
  error: string;
  onRetry: () => void | Promise<void>;
}

export function DependenciesErrorCard({
  error,
  onRetry,
}: DependenciesErrorCardProps) {
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Package className="h-5 w-5" />
          Optional Dependencies
        </CardTitle>
        <CardDescription className="text-destructive">{error}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

interface DependenciesManagerShellProps {
  dependencies: DependenciesResponse;
  runtimeDisplay: PythonRuntimeDisplayState;
  outdatedCount: number;
  isRefreshing: boolean;
  isRefreshDisabled: boolean;
  lastAction: LastActionState | null;
  needsRestart: boolean;
  compact: boolean;
  onRefresh: () => void | Promise<void>;
  onDismissLastAction: () => void;
  onRestartBackend: () => void | Promise<void>;
  children: ReactNode;
}

export function DependenciesManagerShell({
  dependencies,
  runtimeDisplay,
  outdatedCount,
  isRefreshing,
  isRefreshDisabled,
  lastAction,
  needsRestart,
  compact,
  onRefresh,
  onDismissLastAction,
  onRestartBackend,
  children,
}: DependenciesManagerShellProps) {
  return (
    <Card>
      <CardHeader>
        <DependenciesHeader
          cachedAt={dependencies.cached_at}
          isRefreshing={isRefreshing}
          isRefreshDisabled={isRefreshDisabled}
          onRefresh={onRefresh}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <RuntimeAlerts runtimeDisplay={runtimeDisplay} />

        <DependenciesSummaryBar
          dependencies={dependencies}
          runtimeLabel={runtimeDisplay.label}
          outdatedCount={outdatedCount}
        />

        {lastAction && (
          <LastActionNotification
            lastAction={lastAction}
            onDismiss={onDismissLastAction}
          />
        )}

        {needsRestart && (
          <RestartBanner onRestartBackend={onRestartBackend} />
        )}

        {children}

        {!compact && <DependenciesHelpText />}
      </CardContent>
    </Card>
  );
}

interface DependenciesHeaderProps {
  cachedAt: string | null;
  isRefreshing: boolean;
  isRefreshDisabled: boolean;
  onRefresh: () => void | Promise<void>;
}

function DependenciesHeader({
  cachedAt,
  isRefreshing,
  isRefreshDisabled,
  onRefresh,
}: DependenciesHeaderProps) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Optional Dependencies
        </CardTitle>
        <CardDescription>
          Manage nirs4all optional packages for extended functionality
        </CardDescription>
      </div>
      <div className="flex items-center gap-2">
        {cachedAt && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-xs gap-1">
                  <Clock className="h-3 w-3" />
                  Cached
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                Last scanned: {new Date(cachedAt).toLocaleString()}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onRefresh}
                disabled={isRefreshDisabled}
                title="Refresh dependencies"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Force refresh (re-scan packages)
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

function RuntimeAlerts({
  runtimeDisplay,
}: {
  runtimeDisplay: PythonRuntimeDisplayState;
}) {
  return (
    <>
      {runtimeDisplay.isReadOnly && (
        <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription>
            {runtimeDisplay.isBundledEmbedded
              ? "This bundled build is using its embedded Python runtime. Package management is disabled because the embedded runtime is read-only."
              : "This packaged backend runtime is read-only. Package management is disabled in this mode."}
          </AlertDescription>
        </Alert>
      )}

      {runtimeDisplay.isBundledExternal && (
        <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription>
            This bundled build is running on an external Python runtime. Optional package installs and removals now apply to that external environment.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

interface DependenciesSummaryBarProps {
  dependencies: DependenciesResponse;
  runtimeLabel: string;
  outdatedCount: number;
}

function DependenciesSummaryBar({
  dependencies,
  runtimeLabel,
  outdatedCount,
}: DependenciesSummaryBarProps) {
  return (
    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">
            <span className="font-semibold">{dependencies.total_installed}</span>
            <span className="text-muted-foreground">
              /{dependencies.total_packages} installed
            </span>
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          Base nirs4all version is managed in the Updates section above.
        </span>
        <Badge variant="outline" className="text-xs">
          {runtimeLabel}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        {outdatedCount > 0 && (
          <Badge variant="warning">
            {outdatedCount} optional update{outdatedCount > 1 ? "s" : ""} available
          </Badge>
        )}
        {!dependencies.runtime_valid && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Badge variant="outline" className="text-amber-600">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Runtime Issue
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                The current Python runtime is not valid. Use the Python Runtime
                settings to select or create a usable runtime.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}

interface LastActionNotificationProps {
  lastAction: LastActionState;
  onDismiss: () => void;
}

function LastActionNotification({
  lastAction,
  onDismiss,
}: LastActionNotificationProps) {
  return (
    <div
      className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
        lastAction.success
          ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300"
          : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
      }`}
    >
      {lastAction.success ? (
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
      )}
      <span>{formatLastActionText(lastAction)}</span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-6 px-2"
        onClick={onDismiss}
      >
        Dismiss
      </Button>
    </div>
  );
}

function RestartBanner({
  onRestartBackend,
}: {
  onRestartBackend: () => void | Promise<void>;
}) {
  return (
    <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
      <AlertCircle className="h-4 w-4 text-amber-600" />
      <AlertDescription className="flex items-center justify-between">
        <span>Package changes require a backend restart to take effect.</span>
        <Button variant="outline" size="sm" onClick={onRestartBackend}>
          <RotateCcw className="mr-2 h-3 w-3" />
          Restart Backend
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function DependenciesHelpText() {
  return (
    <div className="flex items-start gap-2 p-3 bg-muted/30 rounded-lg text-sm text-muted-foreground">
      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <div>
        <p>
          These packages extend nirs4all functionality. Install only the packages
          you need.
        </p>
        <p className="mt-1">
          <a
            href="https://pypi.org/project/nirs4all/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            View on PyPI
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>
    </div>
  );
}
