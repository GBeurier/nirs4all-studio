/**
 * Dependencies Manager Component
 *
 * Displays nirs4all optional dependencies with installation status
 * and provides install/uninstall/update actions for each package.
 * Supports custom virtual environment paths and caches scan results.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
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
  FolderOpen,
  RotateCcw,
  Clock,
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
import { Input } from "@/components/ui/input";
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
  updateDependency,
  refreshDependencies,
  getVenvPath,
  setVenvPath,
  requestRestart,
  resetBackendUrl,
} from "@/api/client";
import { selectFolder } from "@/utils/fileDialogs";
import type {
  DependenciesResponse,
  DependencyCategory,
  DependencyInfo,
} from "@/api/client";

interface PackageRowProps {
  pkg: DependencyInfo;
  onInstall: (pkg: string) => Promise<void>;
  onUninstall: (pkg: string) => Promise<void>;
  onUpdate: (pkg: string) => Promise<void>;
  isProcessing: string | null;
}

function PackageRow({
  pkg,
  onInstall,
  onUninstall,
  onUpdate,
  isProcessing,
}: PackageRowProps) {
  const isCurrentlyProcessing = isProcessing === pkg.name;

  return (
    <div
      className={`flex items-center justify-between py-3 px-4 rounded-lg border transition-colors ${
        pkg.is_installed
          ? "bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900/50"
          : "bg-muted/30 border-muted"
      }`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Status Icon */}
        <div className="flex-shrink-0">
          {pkg.is_installed ? (
            pkg.is_outdated ? (
              <ArrowUpCircle className="h-5 w-5 text-amber-500" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            )
          ) : (
            <XCircle className="h-5 w-5 text-muted-foreground" />
          )}
        </div>

        {/* Package Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{pkg.name}</span>
            {pkg.is_installed && pkg.installed_version && (
              <Badge variant="secondary" className="text-xs font-mono">
                v{pkg.installed_version}
              </Badge>
            )}
            {pkg.is_outdated && pkg.latest_version && (
              <Badge variant="warning" className="text-xs">
                → {pkg.latest_version}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {pkg.description}
          </p>
          {!pkg.is_installed && (
            <p className="text-xs text-muted-foreground">
              Min version: {pkg.min_version}
            </p>
          )}
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
                {pkg.is_outdated && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onUpdate(pkg.name)}
                          disabled={!!isProcessing}
                          className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/50"
                        >
                          <ArrowUpCircle className="h-4 w-4 mr-1" />
                          Update
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        Update to version {pkg.latest_version}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
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
                      <AlertDialogTitle>Uninstall {pkg.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove {pkg.name} from the managed virtual
                        environment. Some nirs4all features may not work without
                        this package.
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
  onUpdate: (pkg: string) => Promise<void>;
  isProcessing: string | null;
  defaultOpen?: boolean;
}

function CategorySection({
  category,
  onInstall,
  onUninstall,
  onUpdate,
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
            onUpdate={onUpdate}
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
  const { t } = useTranslation();
  const [dependencies, setDependencies] = useState<DependenciesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingPackage, setProcessingPackage] = useState<string | null>(null);
  const [isChangingVenv, setIsChangingVenv] = useState(false);
  const [lastAction, setLastAction] = useState<{
    type: "install" | "uninstall" | "update" | "venv";
    package: string;
    success: boolean;
    message: string;
  } | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);

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

  const handleSelectVenv = async () => {
    const path = await selectFolder();
    if (path) {
      try {
        setIsChangingVenv(true);
        const result = await setVenvPath(path);
        setLastAction({
          type: "venv",
          package: "venv",
          success: result.success,
          message: result.message,
        });
        await loadDependencies(true);
      } catch (err) {
        setLastAction({
          type: "venv",
          package: "venv",
          success: false,
          message: err instanceof Error ? err.message : "Failed to set venv path",
        });
      } finally {
        setIsChangingVenv(false);
      }
    }
  };

  const handleResetVenv = async () => {
    try {
      setIsChangingVenv(true);
      const result = await setVenvPath(null);
      setLastAction({
        type: "venv",
        package: "venv",
        success: result.success,
        message: result.message,
      });
      await loadDependencies(true);
    } catch (err) {
      setLastAction({
        type: "venv",
        package: "venv",
        success: false,
        message: err instanceof Error ? err.message : "Failed to reset venv path",
      });
    } finally {
      setIsChangingVenv(false);
    }
  };

  const handleInstall = async (packageName: string) => {
    try {
      setProcessingPackage(packageName);
      setLastAction(null);
      const result = await installDependency(packageName);
      setLastAction({
        type: "install",
        package: packageName,
        success: result.success,
        message: result.message,
      });
      if (result.requires_restart) setNeedsRestart(true);
      await loadDependencies(true);
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

  const handleUpdate = async (packageName: string) => {
    try {
      setProcessingPackage(packageName);
      setLastAction(null);
      const result = await updateDependency(packageName);
      setLastAction({
        type: "update",
        package: packageName,
        success: result.success,
        message: result.message,
      });
      if (result.requires_restart) setNeedsRestart(true);
      await loadDependencies(true);
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

  useEffect(() => {
    loadDependencies();
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
        {/* Virtual Environment Path */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Python Environment</label>
          <div className="flex gap-2">
            <Input
              value={dependencies.venv_path}
              readOnly
              className="flex-1 font-mono text-xs"
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleSelectVenv}
                    disabled={isChangingVenv || !!processingPackage}
                  >
                    {isChangingVenv ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FolderOpen className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Select custom virtual environment
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {dependencies.venv_is_custom && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleResetVenv}
                      disabled={isChangingVenv || !!processingPackage}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Reset to default managed environment
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={dependencies.venv_valid ? "default" : "destructive"}>
              {dependencies.venv_valid ? "Valid" : "Invalid"}
            </Badge>
            {dependencies.venv_is_custom && (
              <Badge variant="secondary">Custom</Badge>
            )}
          </div>
        </div>

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
            {dependencies.nirs4all_installed && dependencies.nirs4all_version && (
              <Badge variant="default" className="font-mono">
                nirs4all v{dependencies.nirs4all_version}
              </Badge>
            )}
            {!dependencies.nirs4all_installed && (
              <Badge variant="destructive">nirs4all not installed</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {outdatedCount > 0 && (
              <Badge variant="warning">
                {outdatedCount} update{outdatedCount > 1 ? "s" : ""} available
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
                    }
                  } else {
                    await requestRestart();
                    setNeedsRestart(false);
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
              onUpdate={handleUpdate}
              isProcessing={processingPackage}
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
