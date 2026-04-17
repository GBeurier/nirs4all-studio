/**
 * Dependencies Manager Component
 *
 * Displays nirs4all optional dependencies with installation status
 * and provides install/uninstall/update/revert actions for each package.
 * Shows version status relative to recommended versions.
 */

import { useState, useEffect } from "react";
import {
  Package,
  Download,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ArrowUpCircle,
  ChevronDown,
  AlertCircle,
  Loader2,
  ExternalLink,
  RotateCcw,
  Clock,
  Check,
  ArrowDownCircle,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  getDependencies,
  installDependency,
  uninstallDependency,
  refreshDependencies,
  requestRestart,
  resetBackendUrl,
  getBuildInfo,
  revertDependency,
} from "@/api/client";
import { dispatchOperatorAvailabilityInvalidated } from "@/lib/pipelineOperatorAvailability";
import { getDependencyVersionState } from "./dependencyVersionState";
import type {
  DependenciesResponse,
  DependencyCategory,
  DependencyInfo,
} from "@/api/client";

interface PackageRowProps {
  pkg: DependencyInfo;
  onInstall: (pkg: string) => Promise<void>;
  onUninstall: (pkg: string) => Promise<void>;
  onUpdateToLatest: (pkg: string) => Promise<void>;
  onRevertToRecommended: (pkg: string) => Promise<void>;
  isProcessing: string | null;
}

function PackageRow({
  pkg,
  onInstall,
  onUninstall,
  onUpdateToLatest,
  onRevertToRecommended,
  isProcessing,
}: PackageRowProps) {
  const isCurrentlyProcessing = isProcessing === pkg.name;

  const {
    isAtRecommended,
    isAtLatest,
    showRecommendedVersion,
    showLatestVersion,
    showUpdateToRecommended,
    showRevertToRecommended,
    showUpdateToLatest,
    shouldConfirmLatestUpdate,
  } = getDependencyVersionState(pkg);

  // Status icon
  let statusIcon;
  if (!pkg.is_installed) {
    statusIcon = <XCircle className="h-5 w-5 text-muted-foreground" />;
  } else if (pkg.is_below_recommended) {
    statusIcon = <ArrowUpCircle className="h-5 w-5 text-amber-500" />;
  } else if (pkg.is_above_recommended) {
    statusIcon = <ArrowUpCircle className="h-5 w-5 text-blue-500" />;
  } else if (isAtRecommended) {
    statusIcon = <CheckCircle2 className="h-5 w-5 text-green-500" />;
  } else {
    statusIcon = <CheckCircle2 className="h-5 w-5 text-green-500" />;
  }

  // Version badge
  let versionBadge;
  if (!pkg.is_installed) {
    versionBadge = (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        Not installed
      </Badge>
    );
  } else if (isAtRecommended) {
    versionBadge = (
      <Badge className="text-xs font-mono bg-green-600 hover:bg-green-600 text-white gap-1">
        <Check className="h-3 w-3" />
        v{pkg.installed_version} (recommended)
      </Badge>
    );
  } else if (pkg.is_below_recommended) {
    versionBadge = (
      <Badge className="text-xs font-mono bg-amber-500 hover:bg-amber-500 text-white">
        v{pkg.installed_version}
      </Badge>
    );
  } else if (pkg.is_above_recommended) {
    versionBadge = (
      <Badge className="text-xs font-mono bg-blue-500 hover:bg-blue-500 text-white">
        v{pkg.installed_version} ({isAtLatest ? "latest" : "custom"})
      </Badge>
    );
  } else {
    // Installed but no recommended_version
    versionBadge = (
      <Badge variant="secondary" className="text-xs font-mono">
        v{pkg.installed_version}
      </Badge>
    );
  }

  return (
    <div
      className={`flex items-center justify-between py-3 px-4 rounded-lg border transition-colors ${
        pkg.is_installed
          ? pkg.is_below_recommended
            ? "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50"
            : "bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900/50"
          : "bg-muted/30 border-muted"
      }`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Status Icon */}
        <div className="flex-shrink-0">{statusIcon}</div>

        {/* Package Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{pkg.name}</span>
            {versionBadge}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {pkg.description}
          </p>
          {/* Version details line */}
          <div className="flex items-center gap-3 mt-0.5">
            {showRecommendedVersion && pkg.recommended_version && (
                <span className="text-xs text-muted-foreground">
                  Recommended: {pkg.recommended_version}
                </span>
              )}
            {showLatestVersion && pkg.latest_version && (
                <span className="text-xs text-muted-foreground">
                  Latest: {pkg.latest_version}
                </span>
              )}
            {!pkg.is_installed && !pkg.recommended_version && (
              <span className="text-xs text-muted-foreground">
                Min version: {pkg.min_version}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0 ml-4">
        {isCurrentlyProcessing ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Processing...</span>
          </div>
        ) : (
          <>
            {pkg.is_installed ? (
              <>
                {/* Below recommended: Update to Recommended */}
                {showUpdateToRecommended && pkg.recommended_version && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRevertToRecommended(pkg.name)}
                    disabled={!!isProcessing}
                    className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/50"
                  >
                    <ArrowUpCircle className="h-4 w-4 mr-1" />
                    Update to Recommended
                  </Button>
                )}

                {/* Above recommended: Revert to Recommended */}
                {showRevertToRecommended && pkg.recommended_version && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRevertToRecommended(pkg.name)}
                    disabled={!!isProcessing}
                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/50"
                  >
                    <ArrowDownCircle className="h-4 w-4 mr-1" />
                    Revert to Recommended
                  </Button>
                )}

                {/* Update to Latest (when latest > installed and latest != recommended) */}
                {showUpdateToLatest && shouldConfirmLatestUpdate && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!isProcessing}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ArrowUpCircle className="h-4 w-4 mr-1" />
                        Update to Latest
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Update {pkg.name} to latest?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Version {pkg.latest_version} is newer than the
                          recommended {pkg.recommended_version}. This version
                          has not been validated with the webapp. You can always
                          revert to the recommended version.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => onUpdateToLatest(pkg.name)}
                        >
                          Update to {pkg.latest_version}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {/* Update to Latest (simple case: no recommended or latest == recommended) */}
                {showUpdateToLatest &&
                  !shouldConfirmLatestUpdate && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onUpdateToLatest(pkg.name)}
                      disabled={!!isProcessing}
                      className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/50"
                    >
                      <ArrowUpCircle className="h-4 w-4 mr-1" />
                      Update to Latest
                    </Button>
                  )}

                {/* Uninstall */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!isProcessing}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Uninstall {pkg.name}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove {pkg.name} from the managed virtual
                        environment. Some nirs4all features may not work
                        without this package.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => onUninstall(pkg.name)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Uninstall
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onInstall(pkg.name)}
                disabled={!!isProcessing}
                className="text-primary hover:bg-primary/10"
              >
                <Download className="h-4 w-4 mr-1" />
                Install
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface CategorySectionProps {
  category: DependencyCategory;
  onInstall: (pkg: string) => Promise<void>;
  onUninstall: (pkg: string) => Promise<void>;
  onUpdateToLatest: (pkg: string) => Promise<void>;
  onRevertToRecommended: (pkg: string) => Promise<void>;
  isProcessing: string | null;
  defaultOpen?: boolean;
}

function CategorySection({
  category,
  onInstall,
  onUninstall,
  onUpdateToLatest,
  onRevertToRecommended,
  isProcessing,
  defaultOpen = false,
}: CategorySectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const progressPercentage =
    category.total_count > 0
      ? (category.installed_count / category.total_count) * 100
      : 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted/70 transition-colors">
          <div className="flex items-center gap-3">
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                isOpen ? "rotate-180" : ""
              }`}
            />
            <div>
              <h4 className="font-medium text-sm">{category.name}</h4>
              <p className="text-xs text-muted-foreground">
                {category.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-24">
              <Progress value={progressPercentage} className="h-2" />
            </div>
            <Badge
              variant={
                category.installed_count === category.total_count
                  ? "default"
                  : category.installed_count > 0
                  ? "secondary"
                  : "outline"
              }
            >
              {category.installed_count}/{category.total_count}
            </Badge>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {category.packages.map((pkg) => (
          <PackageRow
            key={pkg.name}
            pkg={pkg}
            onInstall={onInstall}
            onUninstall={onUninstall}
            onUpdateToLatest={onUpdateToLatest}
            onRevertToRecommended={onRevertToRecommended}
            isProcessing={isProcessing}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface DependenciesManagerProps {
  /** Whether to show in compact mode */
  compact?: boolean;
}

export function DependenciesManager({ compact = false }: DependenciesManagerProps) {
  const [dependencies, setDependencies] = useState<DependenciesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingPackage, setProcessingPackage] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<{
    type: "install" | "uninstall" | "update";
    package: string;
    success: boolean;
    message: string;
  } | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState<"development" | "managed" | "bundled" | "pyinstaller">("development");

  const isReadOnlyRuntime = runtimeMode === "bundled" || runtimeMode === "pyinstaller";

  const loadDependencies = async (forceRefresh = false) => {
    try {
      if (!forceRefresh) {
        setIsLoading(true);
      }
      setError(null);
      const data = await getDependencies(forceRefresh);
      setDependencies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dependencies");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshDependencies();
    await loadDependencies(true);
  };

  const handleInstall = async (packageName: string) => {
    try {
      setProcessingPackage(packageName);
      setLastAction(null);
      const result = await installDependency(packageName, undefined, false, "recommended");
      setLastAction({
        type: "install",
        package: packageName,
        success: result.success,
        message: result.message,
      });
      if (result.requires_restart) setNeedsRestart(true);
      await loadDependencies(true);
      dispatchOperatorAvailabilityInvalidated();
    } catch (err) {
      setLastAction({
        type: "install",
        package: packageName,
        success: false,
        message: err instanceof Error ? err.message : "Installation failed",
      });
    } finally {
      setProcessingPackage(null);
    }
  };

  const handleUninstall = async (packageName: string) => {
    try {
      setProcessingPackage(packageName);
      setLastAction(null);
      const result = await uninstallDependency(packageName);
      setLastAction({
        type: "uninstall",
        package: packageName,
        success: result.success,
        message: result.message,
      });
      if (result.requires_restart) setNeedsRestart(true);
      await loadDependencies(true);
      dispatchOperatorAvailabilityInvalidated();
    } catch (err) {
      setLastAction({
        type: "uninstall",
        package: packageName,
        success: false,
        message: err instanceof Error ? err.message : "Uninstallation failed",
      });
    } finally {
      setProcessingPackage(null);
    }
  };

  const handleUpdateToLatest = async (packageName: string) => {
    try {
      setProcessingPackage(packageName);
      setLastAction(null);
      const result = await installDependency(packageName, undefined, true, "latest");
      setLastAction({
        type: "update",
        package: packageName,
        success: result.success,
        message: result.message,
      });
      if (result.requires_restart) setNeedsRestart(true);
      await loadDependencies(true);
      dispatchOperatorAvailabilityInvalidated();
    } catch (err) {
      setLastAction({
        type: "update",
        package: packageName,
        success: false,
        message: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setProcessingPackage(null);
    }
  };

  const handleRevertToRecommended = async (packageName: string) => {
    try {
      setProcessingPackage(packageName);
      setLastAction(null);
      const result = await revertDependency(packageName);
      setLastAction({
        type: "update",
        package: packageName,
        success: result.success,
        message: result.message,
      });
      if (result.requires_restart) setNeedsRestart(true);
      await loadDependencies(true);
      dispatchOperatorAvailabilityInvalidated();
    } catch (err) {
      setLastAction({
        type: "update",
        package: packageName,
        success: false,
        message: err instanceof Error ? err.message : "Revert failed",
      });
    } finally {
      setProcessingPackage(null);
    }
  };

  useEffect(() => {
    loadDependencies();
  }, []);

  // Reload after backend restart (e.g., env change in PythonEnvPicker)
  useEffect(() => {
    const handler = () => {
      // Backend just restarted — delay to let it warm up, then force refresh
      setTimeout(() => {
        loadDependencies(true);
      }, 2000);
    };
    window.addEventListener("backend-restarted", handler);
    return () => window.removeEventListener("backend-restarted", handler);
  }, []);

  // Load build info on mount
  useEffect(() => {
    getBuildInfo()
      .then((info) => setRuntimeMode(info.runtime_mode))
      .catch(() => {});
  }, []);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Optional Dependencies
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

  if (error) {
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
          <Button variant="outline" size="sm" onClick={() => loadDependencies()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!dependencies) {
    return null;
  }

  const outdatedCount = dependencies.categories.reduce(
    (acc, cat) => acc + cat.packages.filter((p) => p.is_outdated).length,
    0
  );

  return (
    <Card>
      <CardHeader>
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
            {dependencies.cached_at && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-xs gap-1">
                      <Clock className="h-3 w-3" />
                      Cached
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    Last scanned: {new Date(dependencies.cached_at).toLocaleString()}
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
                    onClick={handleRefresh}
                    disabled={isRefreshing || !!processingPackage}
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
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Read-only packaged runtime banner */}
        {isReadOnlyRuntime && (
          <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription>
              {runtimeMode === "bundled"
                ? "This all-in-one bundle uses an embedded Python runtime. Package management is disabled because the environment is read-only."
                : "This packaged runtime is read-only. Package management is disabled in this backend mode."}
            </AlertDescription>
          </Alert>
        )}

        {/* Summary Bar */}
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
              Runtime: {runtimeMode}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {outdatedCount > 0 && (
              <Badge variant="warning">
                {outdatedCount} optional update{outdatedCount > 1 ? "s" : ""} available
              </Badge>
            )}
            {!dependencies.venv_valid && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Badge variant="outline" className="text-amber-600">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Venv Issue
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    The managed virtual environment is not valid. Create one in
                    the Updates section.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>

        {/* Last Action Notification */}
        {lastAction && (
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
            <span>
              {lastAction.success
                ? `Successfully ${lastAction.type}ed ${lastAction.package}`
                : lastAction.message}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2"
              onClick={() => setLastAction(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Restart Banner */}
        {needsRestart && (
          <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="flex items-center justify-between">
              <span>Package changes require a backend restart to take effect.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const electronApi = (window as Record<string, unknown>).electronApi as { restartBackend?: () => Promise<{ success: boolean }> } | undefined;
                  if (electronApi?.restartBackend) {
                    const result = await electronApi.restartBackend();
                    if (result.success) {
                      resetBackendUrl();
                      setNeedsRestart(false);
                      dispatchOperatorAvailabilityInvalidated();
                      window.dispatchEvent(new CustomEvent("backend-restarted"));
                    }
                  } else {
                    await requestRestart();
                    setNeedsRestart(false);
                    dispatchOperatorAvailabilityInvalidated();
                  }
                }}
              >
                <RotateCcw className="mr-2 h-3 w-3" />
                Restart Backend
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Categories */}
        <div className="space-y-4">
          {dependencies.categories.map((category, index) => (
            <CategorySection
              key={category.id}
              category={category}
              onInstall={handleInstall}
              onUninstall={handleUninstall}
              onUpdateToLatest={handleUpdateToLatest}
              onRevertToRecommended={handleRevertToRecommended}
              isProcessing={isReadOnlyRuntime ? "__frozen__" : processingPackage}
              defaultOpen={index === 0}
            />
          ))}
        </div>

        {/* Help Text */}
        {!compact && (
          <div className="flex items-start gap-2 p-3 bg-muted/30 rounded-lg text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <p>
                These packages extend nirs4all functionality. Install only the
                packages you need.
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
        )}
      </CardContent>
    </Card>
  );
}
