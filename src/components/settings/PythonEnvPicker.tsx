/**
 * Python Environment Picker
 *
 * VSCode-style environment selector for Settings.
 * Shows current Python env and lets the user switch quickly.
 * Only renders in Electron mode (env management via IPC).
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  FolderOpen,
  RefreshCw,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronRight,
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
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  alignConfig,
  formatApiErrorDetail,
  getConfigDiff,
  getDependencies,
  getRuntimeSummary,
  type ConfigComparisonResponse,
  type DependenciesResponse,
  type DependencyInfo,
  type OptionalPackageInfo,
  type PackageFailure,
  type RuntimeSummaryResponse,
} from "@/api/client";
import { PythonEnvInspectionCard } from "@/components/python/PythonEnvInspectionCard";
import {
  announceBackendRestarted,
  loadPostSwitchValidation,
  previewRuntimeAlignment,
  restartBackendForRuntimeSwitch,
} from "@/lib/pythonRuntimeSwitch";
import {
  getDesktopEnvKindLabel,
  getDesktopEnvWriteAccessLabel,
  getPythonRuntimeDisplayState,
} from "@/lib/pythonRuntimeDisplay";
import { getCompatibleProfiles } from "@/lib/setup-config";
import type {
  DesktopDetectedEnv,
  DesktopEnvActionResult,
  DesktopInspectedEnv,
  PostSwitchValidation,
} from "@/types/pythonRuntime";

interface EnvInfo {
  status: string;
  envDir: string;
  pythonPath: string | null;
  sitePackages: string | null;
  pythonVersion: string | null;
  isCustom: boolean;
  error?: string;
}

interface SetupProgress {
  percent: number;
  step: string;
  detail: string;
}

interface BusyProgressState {
  title: string;
  detail: string;
  progress: number;
  ceiling: number;
}

interface ElectronEnvApi {
  getEnvInfo: () => Promise<EnvInfo>;
  detectExistingEnvs: () => Promise<DesktopDetectedEnv[]>;
  inspectExistingEnv: (envPath: string) => Promise<DesktopEnvActionResult>;
  inspectExistingPython: (pythonPath: string) => Promise<DesktopEnvActionResult>;
  applyExistingEnv: (envPath: string, options?: { installCorePackages?: boolean }) => Promise<DesktopEnvActionResult>;
  applyExistingPython: (pythonPath: string, options?: { installCorePackages?: boolean }) => Promise<DesktopEnvActionResult>;
  selectPythonExe: () => Promise<string | null>;
  selectFolder: () => Promise<string | null>;
  startEnvSetup: (targetDir?: string) => Promise<{ success: boolean; error?: string }>;
  onEnvSetupProgress: (cb: (p: SetupProgress) => void) => () => void;
  restartBackend: (options?: { skipEnsure?: boolean }) => Promise<{ success: boolean; port?: number; error?: string }>;
  platform: string;
}

function getElectronApi(): ElectronEnvApi | null {
  const api = (window as unknown as { electronApi?: ElectronEnvApi }).electronApi;
  return api?.getEnvInfo ? api : null;
}

/** Extract short version like "3.11.13" from full version string */
function shortVersion(version: string | null): string {
  if (!version) return "Unknown";
  const match = version.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : version;
}

/** Compare two filesystem paths with normalized separators for cross-platform checks. */
function isSamePath(filePath: string, otherPath: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  return norm(filePath) === norm(otherPath);
}

/** Shorten a path for display — show last 3 segments */
function shortenPath(path: string | null): string {
  if (!path) return "Not configured";
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(sep);
  if (parts.length <= 4) return path;
  return "..." + sep + parts.slice(-3).join(sep);
}

function normalizePackageName(name: string): string {
  return name.replace(/[-_.]+/g, "_").toLowerCase();
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const detail = "detail" in error ? (error as { detail?: unknown }).detail : error;
    const status = "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
    return formatApiErrorDetail(detail, status);
  }

  return fallback;
}

function buildDependencyIndex(dependencies: DependenciesResponse | null): Map<string, DependencyInfo> {
  const byName = new Map<string, DependencyInfo>();
  if (!dependencies) {
    return byName;
  }

  for (const category of dependencies.categories) {
    for (const pkg of category.packages) {
      byName.set(normalizePackageName(pkg.name), pkg);
    }
  }

  return byName;
}

function getOptionalTargetVersion(pkg: OptionalPackageInfo): string {
  return pkg.recommended ?? pkg.min;
}

function getPackageStatusBadge(status: string): { label: string; variant: "default" | "outline" | "secondary" | "destructive" } {
  switch (status) {
    case "aligned":
      return { label: "Present", variant: "outline" };
    case "outdated":
      return { label: "Update needed", variant: "secondary" };
    case "missing":
      return { label: "Not present", variant: "destructive" };
    default:
      return { label: status, variant: "secondary" };
  }
}

function BusyProgressPanel({
  title,
  detail,
  progress,
}: {
  title: string;
  detail: string;
  progress: number;
}) {
  return (
    <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm font-medium">{title}</span>
      </div>
      <Progress value={progress} className="h-2" />
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function PythonEnvPicker() {
  const { t } = useTranslation();
  const [electronApi] = useState(getElectronApi);
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [runtimeSummary, setRuntimeSummary] = useState<RuntimeSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [detectedEnvs, setDetectedEnvs] = useState<DesktopDetectedEnv[]>([]);
  const [inspection, setInspection] = useState<DesktopInspectedEnv | null>(null);
  const [postSwitchValidation, setPostSwitchValidation] = useState<PostSwitchValidation | null>(null);
  const [reviewProfileDiff, setReviewProfileDiff] = useState<ConfigComparisonResponse | null>(null);
  const [reviewDependencies, setReviewDependencies] = useState<DependenciesResponse | null>(null);
  const [isReviewDetailsLoading, setIsReviewDetailsLoading] = useState(false);
  const [isReviewPreviewLoading, setIsReviewPreviewLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchProgressState, setSwitchProgressState] = useState<BusyProgressState | null>(null);
  const [switchResult, setSwitchResult] = useState<{ success: boolean; message: string } | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [alignFailures, setAlignFailures] = useState<PackageFailure[]>([]);
  const [isAligning, setIsAligning] = useState(false);
  const [alignProgress, setAlignProgress] = useState(14);
  const [alignStatus, setAlignStatus] = useState<Pick<BusyProgressState, "title" | "detail">>({
    title: "Aligning runtime",
    detail: "Installing or upgrading the selected runtime packages. This can take a few moments.",
  });

  // Setup progress state (for auto-setup / create-in-folder)
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [setupProgress, setSetupProgress] = useState<SetupProgress>({ percent: 0, step: "", detail: "" });
  const [setupError, setSetupError] = useState<string | null>(null);

  const loadEnvInfo = useCallback(async () => {
    if (!electronApi) return;
    try {
      setIsLoading(true);
      const [info, summary] = await Promise.all([
        electronApi.getEnvInfo(),
        getRuntimeSummary().catch(() => null),
      ]);
      setEnvInfo(info);
      setRuntimeSummary(summary);
    } catch {
      // Silently fail — component shows fallback
    } finally {
      setIsLoading(false);
    }
  }, [electronApi]);

  const loadReviewDetails = useCallback(async (profileId: string) => {
    try {
      setIsReviewDetailsLoading(true);
      const [profileDiff, dependencies] = await Promise.all([
        getConfigDiff(profileId, false, false).catch(() => null),
        getDependencies().catch(() => null),
      ]);
      setReviewProfileDiff(profileDiff);
      setReviewDependencies(dependencies);
    } finally {
      setIsReviewDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEnvInfo();
  }, [loadEnvInfo]);

  useEffect(() => {
    const handler = () => {
      void loadEnvInfo();
    };
    window.addEventListener("backend-restarted", handler);
    return () => window.removeEventListener("backend-restarted", handler);
  }, [loadEnvInfo]);

  // Subscribe to setup progress events
  useEffect(() => {
    if (!electronApi || !isSettingUp) return;
    return electronApi.onEnvSetupProgress(setSetupProgress);
  }, [electronApi, isSettingUp]);

  useEffect(() => {
    if (!isSwitching || !switchProgressState) {
      return;
    }

    const timer = window.setInterval(() => {
      setSwitchProgressState((prev) => {
        if (!prev) {
          return prev;
        }

        const remaining = prev.ceiling - prev.progress;
        if (remaining <= 0) {
          return prev;
        }

        return {
          ...prev,
          progress: Math.min(prev.progress + Math.max(1, remaining / 6), prev.ceiling),
        };
      });
    }, 450);

    return () => window.clearInterval(timer);
  }, [isSwitching, switchProgressState?.ceiling]);

  useEffect(() => {
    if (!isAligning) {
      return;
    }

    setAlignProgress(18);
    const timer = window.setInterval(() => {
      setAlignProgress((prev) => {
        const remaining = 92 - prev;
        if (remaining <= 0) {
          return prev;
        }
        return Math.min(prev + Math.max(1, remaining / 6), 92);
      });
    }, 500);

    return () => window.clearInterval(timer);
  }, [isAligning]);

  const beginSwitchProgress = useCallback((
    title: string,
    detail: string,
    progress: number = 16,
    ceiling: number = 84,
  ) => {
    setSwitchProgressState({ title, detail, progress, ceiling });
    setIsSwitching(true);
  }, []);

  const updateSwitchProgress = useCallback((
    title: string,
    detail: string,
    progress: number,
    ceiling: number = 94,
  ) => {
    setSwitchProgressState((prev) => ({
      title,
      detail,
      progress: Math.max(progress, prev?.progress ?? progress),
      ceiling,
    }));
  }, []);

  const finishSwitchProgress = useCallback(() => {
    setIsSwitching(false);
    setSwitchProgressState(null);
  }, []);

  const compatibleProfiles = getCompatibleProfiles(postSwitchValidation?.config, electronApi?.platform);
  const selectedReviewProfile = compatibleProfiles.some((profile) => profile.id === postSwitchValidation?.selectedProfile)
    ? postSwitchValidation?.selectedProfile ?? ""
    : compatibleProfiles[0]?.id ?? postSwitchValidation?.selectedProfile ?? "";

  useEffect(() => {
    if (!reviewOpen || !postSwitchValidation?.runtimeSummary?.core_ready || !selectedReviewProfile) {
      return;
    }

    let cancelled = false;
    setIsReviewPreviewLoading(true);
    void previewRuntimeAlignment(
      selectedReviewProfile,
      postSwitchValidation.selectedExtras,
    ).then((alignmentPreview) => {
      if (cancelled) {
        return;
      }
      setPostSwitchValidation((prev) => prev ? { ...prev, alignmentPreview } : prev);
    }).finally(() => {
      if (!cancelled) {
        setIsReviewPreviewLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    reviewOpen,
    postSwitchValidation?.runtimeSummary?.core_ready,
    postSwitchValidation?.selectedExtras,
    selectedReviewProfile,
  ]);

  useEffect(() => {
    if (!postSwitchValidation || !selectedReviewProfile || selectedReviewProfile === postSwitchValidation.selectedProfile) {
      return;
    }

    setPostSwitchValidation((prev) => prev ? { ...prev, selectedProfile: selectedReviewProfile } : prev);
  }, [postSwitchValidation, selectedReviewProfile]);

  useEffect(() => {
    if (!reviewOpen || !postSwitchValidation?.runtimeSummary?.core_ready || !selectedReviewProfile) {
      setReviewProfileDiff(null);
      return;
    }

    void loadReviewDetails(selectedReviewProfile);
  }, [
    reviewOpen,
    postSwitchValidation?.runtimeSummary?.core_ready,
    selectedReviewProfile,
    loadReviewDetails,
  ]);

  // Not in Electron → don't render
  if (!electronApi) return null;

  const handleOpenDialog = async () => {
    setDialogOpen(true);
    setInspection(null);
    setSwitchResult(null);
    setReviewError(null);
    setReviewProfileDiff(null);
    setReviewDependencies(null);
    setIsScanning(true);
    try {
      const envs = await electronApi.detectExistingEnvs();
      setDetectedEnvs(envs);
    } catch {
      setDetectedEnvs([]);
    } finally {
      setIsScanning(false);
    }
  };

  const handleInspectResult = (result: DesktopEnvActionResult, fallbackMessage: string) => {
    if (result.success && result.info) {
      setInspection(result.info);
      return;
    }

    setSwitchResult({
      success: false,
      message: result.message || fallbackMessage,
    });
  };

  /** Inspect a detected env (path is the env root directory) */
  const handleSelectDetectedEnv = async (envPath: string) => {
    try {
      beginSwitchProgress(
        "Inspecting environment",
        "Reading Python details, write access, and missing package information for the selected environment.",
        18,
        48,
      );
      setSwitchResult(null);
      const result = await electronApi.inspectExistingEnv(envPath);
      handleInspectResult(result, "Failed to inspect environment");
    } catch (err) {
      setSwitchResult({
        success: false,
        message: getErrorMessage(err, "Failed to inspect environment"),
      });
    } finally {
      finishSwitchProgress();
    }
  };

  /** Browse for a Python executable directly */
  const handleBrowse = async () => {
    const pythonPath = await electronApi.selectPythonExe();
    if (!pythonPath) return;
    try {
      beginSwitchProgress(
        "Inspecting Python executable",
        "Validating the selected interpreter and checking whether the required backend packages are available.",
        18,
        48,
      );
      setSwitchResult(null);
      const result = await electronApi.inspectExistingPython(pythonPath);
      handleInspectResult(result, "Failed to inspect environment");
    } catch (err) {
      setSwitchResult({
        success: false,
        message: getErrorMessage(err, "Failed to inspect environment"),
      });
    } finally {
      finishSwitchProgress();
    }
  };

  const handleApplyInspection = async (installCorePackages: boolean) => {
    if (!inspection) {
      return;
    }

    try {
      beginSwitchProgress(
        installCorePackages ? "Installing core packages" : "Applying runtime",
        installCorePackages
          ? "Installing the backend packages required to start nirs4all in the selected environment."
          : "Switching the app to the selected interpreter and preparing the backend.",
        24,
        80,
      );
      setSwitchResult(null);
      setReviewError(null);

      const result = await electronApi.applyExistingPython(inspection.pythonPath, {
        installCorePackages,
      });
      if (!result.success) {
        setSwitchResult({
          success: false,
          message: result.message,
        });
        return;
      }

      updateSwitchProgress(
        "Restarting backend",
        "The environment has been applied. Restarting the backend on the selected Python runtime.",
        86,
        96,
      );
      const validation = await restartBackendForRuntimeSwitch((options) => electronApi.restartBackend(options));
      setPostSwitchValidation(validation);
      setReviewProfileDiff(null);
      setReviewDependencies(null);
      setDialogOpen(false);
      setInspection(null);
      // Don't auto-open the review dialog — env switch ends here. The card
      // exposes a "Review optional packages" button if the user wants it.
      setSwitchResult({ success: true, message: result.message });
      await loadEnvInfo();
    } catch (err) {
      setSwitchResult({
        success: false,
        message: getErrorMessage(err, "Failed to switch environment"),
      });
    } finally {
      finishSwitchProgress();
    }
  };

  /** Run full standalone setup (download Python + create venv + install packages) */
  const handleSetup = async (targetDir?: string) => {
    setDialogOpen(false);
    setIsSettingUp(true);
    setSetupError(null);
    setSetupProgress({ percent: 0, step: "starting", detail: "Starting setup..." });

    try {
      const result = await electronApi.startEnvSetup(targetDir);
      if (result.success) {
        announceBackendRestarted();
        const validation = await loadPostSwitchValidation();
        setPostSwitchValidation(validation);
        setReviewProfileDiff(null);
        setReviewDependencies(null);
        // Don't auto-open the review dialog — setup ends here.
        setSwitchResult({ success: true, message: "Python environment created." });
        await loadEnvInfo();
      } else {
        setSetupError(result.error || "Setup failed");
      }
    } catch (err) {
      setSetupError(getErrorMessage(err, "Setup failed"));
    } finally {
      setIsSettingUp(false);
    }
  };

  /** Auto-setup: create env in default location */
  const handleAutoSetup = () => handleSetup();

  /** Create in folder: pick a folder then run full setup there */
  const handleCreateInFolder = async () => {
    const folder = await electronApi.selectFolder();
    if (!folder) return;
    await handleSetup(folder);
  };

  const handleOpenReview = async () => {
    setReviewError(null);
    setAlignFailures([]);
    setReviewProfileDiff(null);
    setReviewDependencies(null);
    setReviewOpen(true);
    try {
      const validation = postSwitchValidation ?? await loadPostSwitchValidation();
      setPostSwitchValidation(validation);
      await loadReviewDetails(validation.selectedProfile);
    } catch (err) {
      setReviewError(getErrorMessage(err, "Failed to load runtime review"));
    }
  };

  const updateReviewProfile = (profileId: string) => {
    setReviewError(null);
    setPostSwitchValidation((prev) => prev ? { ...prev, selectedProfile: profileId } : prev);
  };

  const toggleReviewExtra = (packageName: string) => {
    setReviewError(null);
    setPostSwitchValidation((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        selectedExtras: prev.selectedExtras.includes(packageName)
          ? prev.selectedExtras.filter((name) => name !== packageName)
          : [...prev.selectedExtras, packageName],
      };
    });
  };

  const handleAlignRuntime = async () => {
    if (!postSwitchValidation) {
      return;
    }

    try {
      setIsAligning(true);
      setAlignProgress(18);
      setAlignStatus({
        title: "Aligning runtime",
        detail: "Installing or upgrading the selected runtime packages. This can take a few moments.",
      });
      setReviewError(null);
      setAlignFailures([]);
      const result = await alignConfig({
        profile: selectedReviewProfile,
        optional_packages: postSwitchValidation.selectedExtras,
      });
      if (!result.success) {
        setReviewError(result.message);
        setAlignFailures(result.failures ?? []);
        return;
      }

      if (result.requires_restart) {
        setAlignProgress(96);
        setAlignStatus({
          title: "Restarting backend",
          detail: "The runtime was updated successfully. Restarting the backend to load the aligned packages.",
        });

        const restartResult = await electronApi.restartBackend({ skipEnsure: true });
        if (!restartResult.success) {
          setReviewError(restartResult.error || "Runtime aligned, but the backend could not be restarted automatically.");
          return;
        }

        announceBackendRestarted();
      } else {
        setAlignProgress(100);
      }

      setReviewOpen(false);
      setSwitchResult({ success: true, message: result.message });

      try {
        const refreshedValidation = await loadPostSwitchValidation();
        setPostSwitchValidation(refreshedValidation);
        await loadReviewDetails(refreshedValidation.selectedProfile);
      } catch (error) {
        console.warn("[PythonEnvPicker] Align succeeded but post-align refresh failed:", error);
      }

      try {
        await loadEnvInfo();
      } catch (error) {
        console.warn("[PythonEnvPicker] Align succeeded but env summary refresh failed:", error);
      }
    } catch (err) {
      // A network error here usually means the backend was restarted (either
      // by the user or by the Electron health monitor) while the align request
      // was still in flight. Invalidate the cached backend URL so the next call
      // resolves the current port, and best-effort refresh the runtime summary
      // so the dialog reflects what actually landed.
      announceBackendRestarted();
      setReviewError(getErrorMessage(err, "Failed to align runtime"));
      try {
        const refreshedValidation = await loadPostSwitchValidation();
        setPostSwitchValidation(refreshedValidation);
      } catch (refreshError) {
        console.warn("[PythonEnvPicker] Align failed and post-align refresh also failed:", refreshError);
      }
      try {
        await loadEnvInfo();
      } catch (refreshError) {
        console.warn("[PythonEnvPicker] Align failed and env summary refresh also failed:", refreshError);
      }
    } finally {
      setIsAligning(false);
    }
  };

  const isReady = runtimeSummary
    ? runtimeSummary.core_ready && !!runtimeSummary.running_python
    : envInfo?.status === "ready" && envInfo.pythonPath;
  const runningPythonPath = runtimeSummary?.running_python ?? envInfo?.pythonPath ?? null;
  const runtimeVersion = runtimeSummary?.runtime.version ?? envInfo?.pythonVersion ?? null;
  const runtimeDisplay = getPythonRuntimeDisplayState(runtimeSummary);
  const missingCoreCount = runtimeSummary?.missing_core_packages.length ?? 0;
  const missingOptionalCount = runtimeSummary?.missing_optional_packages.length ?? 0;
  const reviewDependencyIndex = buildDependencyIndex(reviewDependencies);
  const hasAlignmentPreview = postSwitchValidation?.alignmentPreview !== null;
  const alignmentChangesCount = postSwitchValidation?.alignmentPreview?.installed.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h3" />
                <path d="M12 15h7a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3" />
                <path d="M8 9V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2Z" />
                <circle cx="7.5" cy="15.5" r="1" fill="currentColor" stroke="none" />
                <circle cx="16.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
              </svg>
              {t("settings.pythonEnv.title")}
            </CardTitle>
            <CardDescription>
              {t("settings.pythonEnv.description")}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={loadEnvInfo}
            disabled={isLoading || isSettingUp}
            title={t("common.refresh")}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
          </div>
        ) : (
          <>
            {/* Current environment display */}
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {isReady ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">
                      Python {shortVersion(runtimeVersion)}
                    </span>
                    <Badge variant={isReady ? "default" : "destructive"} className="text-xs">
                      {isReady ? t("settings.pythonEnv.ready") : t("settings.pythonEnv.notReady")}
                    </Badge>
                    {runtimeDisplay.label && (
                      <Badge variant="secondary" className="text-xs">
                        {runtimeDisplay.label}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Running Python</p>
                    <p className="text-xs font-mono truncate" title={runningPythonPath ?? undefined}>
                      {shortenPath(runningPythonPath)}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {missingCoreCount > 0
                      ? `${missingCoreCount} core package${missingCoreCount === 1 ? "" : "s"} missing`
                      : missingOptionalCount > 0
                        ? `${missingOptionalCount} optional package${missingOptionalCount === 1 ? "" : "s"} missing`
                        : "Core runtime ready"}
                  </p>
                </div>
              </div>
              <div className="ml-3 flex flex-shrink-0 flex-col gap-2 sm:flex-row">
                {isReady && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { void handleOpenReview(); }}
                    disabled={isSettingUp}
                    title="Review optional packages and align with the recommended profile"
                  >
                    Review packages
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleOpenDialog} disabled={isSettingUp}>
                  {t("settings.pythonEnv.change")}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>

            {/* Switch success toast */}
            {switchResult && switchResult.success && (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription>{switchResult.message}</AlertDescription>
              </Alert>
            )}

            {/* Setup progress (shown when auto-setup or create-in-folder is running) */}
            {isSettingUp && (
              <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm font-medium">{t("settings.pythonEnv.settingUp")}</span>
                </div>
                <Progress value={setupProgress.percent} className="h-2" />
                <p className="text-xs text-muted-foreground">{setupProgress.detail}</p>
              </div>
            )}

            {/* Setup error */}
            {setupError && !isSettingUp && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{setupError}</AlertDescription>
              </Alert>
            )}

            {runtimeDisplay.isBundledEmbedded && (
              <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertDescription>
                  This bundled build is still using its embedded Python runtime. Switch to an external Python environment if you want updates and dependency changes to target a user-managed runtime.
                </AlertDescription>
              </Alert>
            )}

            {runtimeDisplay.isBundledExternal && (
              <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription>
                  This bundled build is now running on an external Python runtime. Updates and dependency changes now apply to that external environment instead of the embedded bundled runtime.
                </AlertDescription>
              </Alert>
            )}

            {/* Switch result feedback */}
            {switchResult && !switchResult.success && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{switchResult.message}</AlertDescription>
              </Alert>
            )}
          </>
        )}

        {/* Switch environment dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{t("settings.pythonEnv.selectInterpreter")}</DialogTitle>
              <DialogDescription>
                {t("settings.pythonEnv.selectInterpreterDesc")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {switchProgressState && !inspection && (
                <BusyProgressPanel
                  title={switchProgressState.title}
                  detail={switchProgressState.detail}
                  progress={switchProgressState.progress}
                />
              )}

              {inspection ? (
                <PythonEnvInspectionCard
                  inspection={inspection}
                  busy={isSwitching}
                  busyTitle={switchProgressState?.title}
                  busyDetail={switchProgressState?.detail}
                  busyProgress={switchProgressState?.progress}
                  onBack={() => setInspection(null)}
                  onUseAsIs={() => {
                    void handleApplyInspection(false);
                  }}
                  onInstallCoreAndSwitch={() => {
                    void handleApplyInspection(true);
                  }}
                />
              ) : (
                <>
                  {/* Detected envs */}
                  {isScanning ? (
                    <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{t("settings.pythonEnv.scanning")}</span>
                    </div>
                  ) : detectedEnvs.length > 0 ? (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t("settings.pythonEnv.detected")}</label>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {detectedEnvs.map((env) => {
                          const isCurrent = runningPythonPath
                            ? isSamePath(runningPythonPath, env.pythonPath)
                            : false;
                          return (
                            <button
                              key={env.pythonPath}
                              onClick={() => !isCurrent && handleSelectDetectedEnv(env.path)}
                              disabled={isSwitching || !!isCurrent}
                              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                                isCurrent
                                  ? "bg-primary/5 border-primary/30 cursor-default"
                                  : "hover:bg-muted/70 cursor-pointer border-muted"
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-sm">
                                    Python {env.pythonVersion}
                                  </span>
                                  <Badge variant="secondary" className="text-xs">
                                    {getDesktopEnvKindLabel(env.envKind)}
                                  </Badge>
                                  <Badge variant={env.hasCorePackages ? "outline" : "destructive"} className="text-xs">
                                    {env.hasCorePackages ? "Core ready" : "Core missing"}
                                  </Badge>
                                  <Badge variant={env.writable ? "outline" : "secondary"} className="text-xs">
                                    {getDesktopEnvWriteAccessLabel(env.writable)}
                                  </Badge>
                                  {isCurrent && (
                                    <Badge variant="default" className="text-xs">{t("settings.pythonEnv.current")}</Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate" title={env.path}>
                                  Root: {env.path}
                                </p>
                                <p className="text-xs text-muted-foreground truncate" title={env.pythonPath}>
                                  Executable: {env.pythonPath}
                                </p>
                              </div>
                              {!isCurrent && <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-muted/50 rounded-lg text-sm text-muted-foreground">
                      {t("settings.pythonEnv.noEnvsFound")}
                    </div>
                  )}

                  <Separator />

                  {/* Browse for Python */}
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={handleBrowse}
                    disabled={isSwitching}
                  >
                    {isSwitching ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FolderOpen className="mr-2 h-4 w-4" />
                    )}
                    {t("settings.pythonEnv.browseForPython")}
                  </Button>

                  <Separator />

                  {/* Create new environment */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("settings.pythonEnv.createNew")}</label>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={handleAutoSetup}
                        disabled={isSwitching}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        {t("settings.pythonEnv.autoSetup")}
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={handleCreateInFolder}
                        disabled={isSwitching}
                      >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        {t("settings.pythonEnv.createInFolder")}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Review Runtime After Switch</DialogTitle>
              <DialogDescription>
                The backend is now running under the selected interpreter. Review the profile and package targets for this machine, then align the runtime if needed.
              </DialogDescription>
            </DialogHeader>

            {postSwitchValidation ? (
              <div className="space-y-4 mt-2">
                <div className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">
                      Python {shortVersion(postSwitchValidation.runtimeSummary?.runtime.version ?? null)}
                    </span>
                    <Badge variant={postSwitchValidation.runtimeSummary?.core_ready ? "default" : "destructive"} className="text-xs">
                      {postSwitchValidation.runtimeSummary?.core_ready ? "Core ready" : "Core missing"}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {postSwitchValidation.runtimeSummary?.runtime_kind ?? runtimeDisplay.runtimeKind}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    {postSwitchValidation.runtimeSummary?.running_python ?? runningPythonPath}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(postSwitchValidation.runtimeSummary?.missing_optional_packages.length ?? 0) > 0
                      ? `${postSwitchValidation.runtimeSummary?.missing_optional_packages.length ?? 0} optional package gap${(postSwitchValidation.runtimeSummary?.missing_optional_packages.length ?? 0) === 1 ? "" : "s"} detected.`
                      : "No optional package gaps detected."}
                  </p>
                </div>

                {isAligning && (
                  <BusyProgressPanel
                    title={alignStatus.title}
                    detail={alignStatus.detail}
                    progress={alignProgress}
                  />
                )}

                {isReviewPreviewLoading ? (
                  <Alert>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <AlertDescription>
                      Preparing the alignment plan for the selected profile and optional packages.
                    </AlertDescription>
                  </Alert>
                ) : alignmentChangesCount > 0 ? (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {postSwitchValidation.alignmentPreview?.message}
                    </AlertDescription>
                  </Alert>
                ) : hasAlignmentPreview ? (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription>
                      The selected runtime already matches the suggested profile and selected optional packages.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      The alignment plan could not be loaded for this runtime yet.
                    </AlertDescription>
                  </Alert>
                )}

                {reviewError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{reviewError}</AlertDescription>
                  </Alert>
                )}

                {alignFailures.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Install errors</p>
                    {alignFailures.map((failure) => (
                      <details
                        key={failure.package}
                        className="rounded-lg border border-destructive/40 bg-destructive/5 p-3"
                      >
                        <summary className="cursor-pointer text-sm font-medium">
                          {failure.package}
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-background/50 p-2 text-[11px] font-mono text-muted-foreground">
                          {failure.error}
                        </pre>
                      </details>
                    ))}
                  </div>
                )}

                {compatibleProfiles.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Compute profile</label>
                    <div className="space-y-2">
                      {compatibleProfiles.map((profile) => (
                        <button
                          key={profile.id}
                          type="button"
                          onClick={() => updateReviewProfile(profile.id)}
                          className={`w-full rounded-lg border p-3 text-left transition-colors ${
                            selectedReviewProfile === profile.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{profile.label}</span>
                            {postSwitchValidation.gpuInfo?.recommended_profiles[0] === profile.id && (
                              <Badge variant="default" className="text-xs">Recommended</Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{profile.description}</p>
                          <div className="mt-2 flex gap-1 flex-wrap">
                            {Object.entries(profile.packages).map(([packageName, packageSpec]) => (
                              <Badge key={packageName} variant="outline" className="text-xs">
                                {packageName} {packageSpec.recommended ?? packageSpec.min}
                              </Badge>
                            ))}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium">Target packages for the selected profile</label>
                  {isReviewDetailsLoading ? (
                    <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Loading current and target versions…</span>
                    </div>
                  ) : reviewProfileDiff?.packages.length ? (
                    <div className="space-y-2">
                      {reviewProfileDiff.packages.map((pkg) => {
                        const badge = getPackageStatusBadge(pkg.status);
                        return (
                          <div key={pkg.name} className="rounded-lg border p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium">{pkg.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  Current: {pkg.installed_version ?? "Not present"}
                                </p>
                              </div>
                              <Badge variant={badge.variant} className="text-xs">
                                {badge.label}
                              </Badge>
                            </div>
                            <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                              <div>
                                <p className="uppercase tracking-wide">Current version</p>
                                <p className="mt-1 font-mono text-foreground">
                                  {pkg.installed_version ?? "Not present"}
                                </p>
                              </div>
                              <div>
                                <p className="uppercase tracking-wide">Target version</p>
                                <p className="mt-1 font-mono text-foreground">{pkg.recommended_version}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      Package details are not available for this runtime yet.
                    </div>
                  )}
                </div>

                {postSwitchValidation.visibleOptionalPackages.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Optional feature packages</label>
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {postSwitchValidation.visibleOptionalPackages.map((pkg) => {
                        const dependency = reviewDependencyIndex.get(normalizePackageName(pkg.name));
                        const isSelected = postSwitchValidation.selectedExtras.includes(pkg.name);
                        const currentVersion = isReviewDetailsLoading
                          ? "Loading..."
                          : dependency?.installed_version ?? "Not present";
                        const isInstalled = !isReviewDetailsLoading && Boolean(dependency?.installed_version);

                        return (
                          <button
                            key={pkg.name}
                            type="button"
                            onClick={() => toggleReviewExtra(pkg.name)}
                            className={`w-full rounded-lg border p-3 text-left transition-colors ${
                              isSelected
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-primary/50"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium">{pkg.name}</p>
                                  {pkg.default_install && (
                                    <Badge variant="secondary" className="text-xs">
                                      {t("common.default")}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">{pkg.description}</p>
                              </div>
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <Badge variant={isSelected ? "default" : "outline"} className="text-xs">
                                  {isSelected ? "Selected" : "Skip"}
                                </Badge>
                                <Badge variant={isReviewDetailsLoading ? "secondary" : isInstalled ? "outline" : "secondary"} className="text-xs">
                                  {isReviewDetailsLoading ? "Checking" : isInstalled ? "Present" : "Not present"}
                                </Badge>
                              </div>
                            </div>
                            <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                              <div>
                                <p className="uppercase tracking-wide">Current version</p>
                                <p className="mt-1 font-mono text-foreground">{currentVersion}</p>
                              </div>
                              <div>
                                <p className="uppercase tracking-wide">Target version</p>
                                <p className="mt-1 font-mono text-foreground">
                                  {getOptionalTargetVersion(pkg)}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
              </div>
            )}

            <DialogFooter>
              <Button
                onClick={() => {
                  void handleAlignRuntime();
                }}
                disabled={
                  isAligning
                  || !postSwitchValidation?.runtimeSummary?.core_ready
                  || !selectedReviewProfile
                  || !hasAlignmentPreview
                  || alignmentChangesCount === 0
                }
              >
                {isAligning ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : hasAlignmentPreview && alignmentChangesCount === 0 ? (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                {isAligning ? "Aligning runtime..." : hasAlignmentPreview && alignmentChangesCount === 0 ? "Runtime aligned" : "Align runtime"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
