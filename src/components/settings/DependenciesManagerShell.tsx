import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
import { getActiveLocale } from "@/lib/activeLocale";

interface DependenciesLoadingCardProps {
  title?: string;
}

export function DependenciesLoadingCard({
  title,
}: DependenciesLoadingCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          {title ?? t("settings.dependencies.title")}
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
  const { t } = useTranslation();
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Package className="h-5 w-5" />
          {t("settings.dependencies.title")}
        </CardTitle>
        <CardDescription className="text-destructive">{error}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("common.retry")}
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

        {!compact && !runtimeDisplay.isReadOnly && <DependenciesHelpText />}
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
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between">
      <div>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          {t("settings.dependencies.title")}
        </CardTitle>
        <CardDescription>
          {t("settings.dependencies.description")}
        </CardDescription>
      </div>
      <div className="flex items-center gap-2">
        {cachedAt && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-xs gap-1">
                  <Clock className="h-3 w-3" />
                  {t("settings.dependencies.cached")}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t("settings.dependencies.lastScanned", { date: new Date(cachedAt).toLocaleString(getActiveLocale()) })}
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
                title={t("settings.dependencies.refresh")}
                aria-label={t("settings.dependencies.refresh")}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("settings.dependencies.forceRefresh")}
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
  const { t } = useTranslation();
  return (
    <>
      {runtimeDisplay.isReadOnly && (
        <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription>
            {runtimeDisplay.isBundledEmbedded
              ? t("settings.dependencies.readOnlyBundled")
              : t("settings.dependencies.readOnlyExternal")}
          </AlertDescription>
        </Alert>
      )}

      {runtimeDisplay.isBundledExternal && !runtimeDisplay.isReadOnly && (
        <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription>
            {t("settings.dependencies.externalRuntime")}
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
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">
            <span className="font-semibold">{dependencies.total_installed}</span>
            <span className="text-muted-foreground">
              {t("settings.dependencies.installedCount", { total: dependencies.total_packages })}
            </span>
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {t("settings.dependencies.baseVersionNote")}
        </span>
        <Badge variant="outline" className="text-xs">
          {runtimeLabel}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        {outdatedCount > 0 && (
          <Badge variant="warning">
            {t("settings.dependencies.updatesAvailable", { count: outdatedCount })}
          </Badge>
        )}
        {!dependencies.runtime_valid && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Badge variant="outline" className="text-amber-600">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  {t("settings.dependencies.runtimeIssue")}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t("settings.dependencies.runtimeInvalid")}
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
  const { t } = useTranslation();
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
      <span>{formatLastActionText(lastAction, t)}</span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-6 px-2"
        onClick={onDismiss}
      >
        {t("settings.dependencies.dismiss")}
      </Button>
    </div>
  );
}

function RestartBanner({
  onRestartBackend,
}: {
  onRestartBackend: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
      <AlertCircle className="h-4 w-4 text-amber-600" />
      <AlertDescription className="flex items-center justify-between">
        <span>{t("settings.dependencies.restartRequired")}</span>
        <Button variant="outline" size="sm" onClick={onRestartBackend}>
          <RotateCcw className="mr-2 h-3 w-3" />
          {t("settings.dependencies.restartBackend")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function DependenciesHelpText() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 p-3 bg-muted/30 rounded-lg text-sm text-muted-foreground">
      <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <div>
        <p>
          {t("settings.dependencies.helpText")}
        </p>
        <p className="mt-1">
          <a
            href="https://pypi.org/project/nirs4all/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            {t("settings.dependencies.viewOnPypi")}
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>
    </div>
  );
}
