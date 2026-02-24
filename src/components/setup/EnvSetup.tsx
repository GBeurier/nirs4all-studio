/**
 * Python Environment Setup Screen
 *
 * Shown on first launch in Electron mode when no Python environment is available.
 * Handles downloading Python runtime and creating the venv via IPC,
 * entirely without backend API calls (the backend isn't running yet).
 */

import { useState, useEffect, useCallback } from "react";
import {
  Download,
  FolderOpen,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronRight,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Phase = "welcome" | "detecting" | "setup" | "done" | "error";

interface DetectedEnv {
  path: string;
  pythonVersion: string;
  hasNirs4all: boolean;
}

interface SetupProgress {
  percent: number;
  step: string;
  detail: string;
}

const electronApi = (window as unknown as {
  electronApi?: {
    isEnvReady: () => Promise<boolean>;
    startEnvSetup: () => Promise<{ success: boolean; error?: string }>;
    onEnvSetupProgress: (cb: (p: SetupProgress) => void) => () => void;
    detectExistingEnvs: () => Promise<DetectedEnv[]>;
    useExistingEnv: (path: string) => Promise<{ success: boolean; message: string }>;
    selectFolder: () => Promise<string | null>;
    selectPythonExe: () => Promise<string | null>;
    useExistingPython: (path: string) => Promise<{ success: boolean; message: string }>;
    restartBackend: () => Promise<{ success: boolean; error?: string }>;
  };
}).electronApi;

interface EnvSetupProps {
  onComplete: () => void;
}

export default function EnvSetup({ onComplete }: EnvSetupProps) {
  const [phase, setPhase] = useState<Phase>("welcome");
  const [detectedEnvs, setDetectedEnvs] = useState<DetectedEnv[]>([]);
  const [detectingEnvs, setDetectingEnvs] = useState(false);
  const [progress, setProgress] = useState<SetupProgress>({ percent: 0, step: "", detail: "" });
  const [error, setError] = useState<string | null>(null);

  // Detect existing envs on mount
  useEffect(() => {
    if (!electronApi) return;
    setDetectingEnvs(true);
    electronApi.detectExistingEnvs().then((envs) => {
      setDetectedEnvs(envs);
      setDetectingEnvs(false);
    }).catch(() => setDetectingEnvs(false));
  }, []);

  // Subscribe to setup progress
  useEffect(() => {
    if (!electronApi) return;
    const cleanup = electronApi.onEnvSetupProgress((p) => {
      setProgress(p);
    });
    return cleanup;
  }, []);

  const handleAutoSetup = useCallback(async () => {
    if (!electronApi) return;
    setPhase("setup");
    setError(null);
    setProgress({ percent: 0, step: "starting", detail: "Starting setup..." });

    const result = await electronApi.startEnvSetup();
    if (result.success) {
      setPhase("done");
    } else {
      setError(result.error || "Setup failed");
      setPhase("error");
    }
  }, []);

  const handleUseExisting = useCallback(async (envPath: string) => {
    if (!electronApi) return;
    setPhase("setup");
    setProgress({ percent: 50, step: "validating", detail: "Validating environment..." });

    const result = await electronApi.useExistingEnv(envPath);
    if (result.success) {
      // Start the backend
      setProgress({ percent: 80, step: "starting", detail: "Starting backend..." });
      const backendResult = await electronApi.restartBackend();
      if (backendResult.success) {
        setPhase("done");
      } else {
        setError(backendResult.error || "Failed to start backend");
        setPhase("error");
      }
    } else {
      setError(result.message);
      setPhase("error");
    }
  }, []);

  const handleBrowsePython = useCallback(async () => {
    if (!electronApi) return;
    const pythonPath = await electronApi.selectPythonExe();
    if (!pythonPath) return;

    setPhase("setup");
    setProgress({ percent: 50, step: "validating", detail: "Validating Python executable..." });

    const result = await electronApi.useExistingPython(pythonPath);
    if (result.success) {
      setProgress({ percent: 80, step: "starting", detail: "Starting backend..." });
      const backendResult = await electronApi.restartBackend();
      if (backendResult.success) {
        setPhase("done");
      } else {
        setError(backendResult.error || "Failed to start backend");
        setPhase("error");
      }
    } else {
      setError(result.message);
      setPhase("error");
    }
  }, []);

  const handleRetry = useCallback(() => {
    setPhase("welcome");
    setError(null);
  }, []);

  const stepLabel = (step: string): string => {
    switch (step) {
      case "downloading": return "Downloading Python";
      case "extracting": return "Extracting runtime";
      case "creating_venv": return "Creating environment";
      case "installing": return "Installing packages";
      case "ready": return "Ready";
      default: return "Setting up";
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-xl">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">nirs4all Studio</h1>
          <p className="text-muted-foreground">Near-Infrared Spectroscopy Analysis</p>
        </div>

        {/* Welcome Phase */}
        {phase === "welcome" && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle>Python Environment Setup</CardTitle>
              <CardDescription>
                nirs4all Studio needs a Python environment to run its analysis backend.
                This is a one-time setup that downloads ~30 MB and installs the required packages.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Auto setup option */}
              <Button
                className="w-full h-auto py-4 flex-col items-start gap-1"
                onClick={handleAutoSetup}
              >
                <div className="flex items-center gap-2 w-full">
                  <Download className="h-5 w-5 shrink-0" />
                  <span className="font-medium">Set up automatically</span>
                  <Badge variant="secondary" className="ml-auto">Recommended</Badge>
                </div>
                <span className="text-xs text-primary-foreground/70 pl-7">
                  Downloads Python 3.11 and installs nirs4all + dependencies
                </span>
              </Button>

              {/* Divider */}
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or</span>
                </div>
              </div>

              {/* Detected environments */}
              {detectingEnvs ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground justify-center py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Scanning for existing Python environments...</span>
                </div>
              ) : detectedEnvs.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    Detected Python environments:
                  </p>
                  {detectedEnvs.map((env) => (
                    <button
                      key={env.path}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border hover:border-primary/50 hover:bg-accent/50 transition-colors text-left"
                      onClick={() => handleUseExisting(env.path)}
                    >
                      <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{env.path}</p>
                        <p className="text-xs text-muted-foreground">
                          Python {env.pythonVersion}
                          {env.hasNirs4all && " \u00b7 nirs4all installed"}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Browse for python executable */}
              <Button
                variant="outline"
                className="w-full"
                onClick={handleBrowsePython}
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                Browse for Python executable
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Setup Progress Phase */}
        {phase === "setup" && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="flex items-center justify-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Setting up Python environment
              </CardTitle>
              <CardDescription>
                {stepLabel(progress.step)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={progress.percent} className="h-2" />
              <p className="text-sm text-center text-muted-foreground">
                {progress.detail}
              </p>
              <p className="text-xs text-center text-muted-foreground/60">
                This may take a few minutes on first setup
              </p>
            </CardContent>
          </Card>
        )}

        {/* Done Phase */}
        {phase === "done" && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="flex items-center justify-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Environment ready
              </CardTitle>
              <CardDescription>
                Python environment is set up and the backend is running.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center pt-2">
              <Button size="lg" onClick={onComplete}>
                Continue
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Error Phase */}
        {phase === "error" && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="flex items-center justify-center gap-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
                Setup failed
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
              <div className="flex justify-center gap-2">
                <Button variant="outline" onClick={handleRetry}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Try again
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
