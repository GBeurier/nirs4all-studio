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
  FolderOpen,
  RefreshCw,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronRight,
  RotateCcw,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resetBackendUrl } from "@/api/client";

interface EnvInfo {
  status: string;
  envDir: string;
  pythonPath: string | null;
  sitePackages: string | null;
  pythonVersion: string | null;
  isCustom: boolean;
  error?: string;
}

interface DetectedEnv {
  path: string;
  pythonVersion: string;
  hasNirs4all: boolean;
}

interface ElectronEnvApi {
  getEnvInfo: () => Promise<EnvInfo>;
  detectExistingEnvs: () => Promise<DetectedEnv[]>;
  useExistingEnv: (envPath: string) => Promise<{ success: boolean; message: string; info?: DetectedEnv }>;
  useExistingPython: (pythonPath: string) => Promise<{ success: boolean; message: string; info?: DetectedEnv }>;
  selectPythonExe: () => Promise<string | null>;
  restartBackend: () => Promise<{ success: boolean; port?: number; error?: string }>;
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

/** Check if a file path is under a directory (normalize separators for cross-platform) */
function isPathUnder(filePath: string, dirPath: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  return norm(filePath).startsWith(norm(dirPath) + "/");
}

/** Shorten a path for display — show last 3 segments */
function shortenPath(path: string | null): string {
  if (!path) return "Not configured";
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(sep);
  if (parts.length <= 4) return path;
  return "..." + sep + parts.slice(-3).join(sep);
}

export function PythonEnvPicker() {
  const { t } = useTranslation();
  const [electronApi] = useState(getElectronApi);
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detectedEnvs, setDetectedEnvs] = useState<DetectedEnv[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchResult, setSwitchResult] = useState<{ success: boolean; message: string } | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  const loadEnvInfo = useCallback(async () => {
    if (!electronApi) return;
    try {
      setIsLoading(true);
      const info = await electronApi.getEnvInfo();
      setEnvInfo(info);
    } catch {
      // Silently fail — component shows fallback
    } finally {
      setIsLoading(false);
    }
  }, [electronApi]);

  useEffect(() => {
    loadEnvInfo();
  }, [loadEnvInfo]);

  // Not in Electron → don't render
  if (!electronApi) return null;

  const handleOpenDialog = async () => {
    setDialogOpen(true);
    setSwitchResult(null);
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

  /** Switch to a detected env (path is the env root directory) */
  const handleSelectDetectedEnv = async (envPath: string) => {
    try {
      setIsSwitching(true);
      setSwitchResult(null);
      const result = await electronApi.useExistingEnv(envPath);
      setSwitchResult({ success: result.success, message: result.message });
      if (result.success) {
        setNeedsRestart(true);
        setDialogOpen(false);
        await loadEnvInfo();
      }
    } catch (err) {
      setSwitchResult({
        success: false,
        message: err instanceof Error ? err.message : "Failed to switch environment",
      });
    } finally {
      setIsSwitching(false);
    }
  };

  /** Browse for a Python executable directly */
  const handleBrowse = async () => {
    const pythonPath = await electronApi.selectPythonExe();
    if (!pythonPath) return;
    try {
      setIsSwitching(true);
      setSwitchResult(null);
      const result = await electronApi.useExistingPython(pythonPath);
      setSwitchResult({ success: result.success, message: result.message });
      if (result.success) {
        setNeedsRestart(true);
        setDialogOpen(false);
        await loadEnvInfo();
      }
    } catch (err) {
      setSwitchResult({
        success: false,
        message: err instanceof Error ? err.message : "Failed to switch environment",
      });
    } finally {
      setIsSwitching(false);
    }
  };

  const handleRestart = async () => {
    try {
      setIsRestarting(true);
      const result = await electronApi.restartBackend();
      if (result.success) {
        // Reset cached URL so API client re-resolves the new port
        resetBackendUrl();
        setNeedsRestart(false);
      }
    } catch {
      // Failed to restart — user can try again
    } finally {
      setIsRestarting(false);
    }
  };

  const isReady = envInfo?.status === "ready" && envInfo.pythonPath;

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
            disabled={isLoading}
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
                      Python {shortVersion(envInfo?.pythonVersion ?? null)}
                    </span>
                    <Badge variant={isReady ? "default" : "destructive"} className="text-xs">
                      {isReady ? t("settings.pythonEnv.ready") : t("settings.pythonEnv.notReady")}
                    </Badge>
                    {envInfo?.isCustom && (
                      <Badge variant="secondary" className="text-xs">
                        {t("common.custom")}
                      </Badge>
                    )}
                    {!envInfo?.isCustom && isReady && (
                      <Badge variant="outline" className="text-xs">
                        {t("settings.pythonEnv.managed")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5" title={envInfo?.pythonPath ?? undefined}>
                    {shortenPath(envInfo?.pythonPath ?? null)}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleOpenDialog} className="ml-3 flex-shrink-0">
                {t("settings.pythonEnv.change")}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>

            {/* Restart banner */}
            {needsRestart && (
              <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="flex items-center justify-between">
                  <span>{t("settings.pythonEnv.restartNeeded")}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRestart}
                    disabled={isRestarting}
                  >
                    {isRestarting ? (
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="mr-2 h-3 w-3" />
                    )}
                    {t("settings.pythonEnv.restartBackend")}
                  </Button>
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
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("settings.pythonEnv.selectInterpreter")}</DialogTitle>
              <DialogDescription>
                {t("settings.pythonEnv.selectInterpreterDesc")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-2">
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
                      // env.path is the env root; envInfo.envDir is the managed env root
                      // For custom envs, compare with envDir (which is the env root from settings)
                      const isCurrent = envInfo?.pythonPath && isPathUnder(envInfo.pythonPath, env.path);
                      return (
                        <button
                          key={env.path}
                          onClick={() => !isCurrent && handleSelectDetectedEnv(env.path)}
                          disabled={isSwitching || !!isCurrent}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                            isCurrent
                              ? "bg-primary/5 border-primary/30 cursor-default"
                              : "hover:bg-muted/70 cursor-pointer border-muted"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">
                                Python {env.pythonVersion}
                              </span>
                              {env.hasNirs4all && (
                                <Badge variant="secondary" className="text-xs">nirs4all</Badge>
                              )}
                              {isCurrent && (
                                <Badge variant="default" className="text-xs">{t("settings.pythonEnv.current")}</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate" title={env.path}>
                              {env.path}
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
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
