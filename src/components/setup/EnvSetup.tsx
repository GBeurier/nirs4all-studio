/**
 * Unified First-Launch Setup Wizard
 *
 * Shown on first launch in Electron mode when no Python environment is available.
 * Combines environment selection (pre-backend, IPC only) with profile/package
 * configuration (post-backend, API calls) into a single cohesive wizard.
 *
 * Steps:
 * 1. env         — Choose: auto-setup, existing env, or browse
 * 2. env-progress — Download/validate Python + start backend
 * 3. detect      — GPU detection (auto-advances)
 * 4. profile     — Select compute profile (platform-filtered)
 * 5. extras      — Optional packages
 * 6. install     — Install profile + extras via API
 * 7. done        — Summary + launch
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "@/lib/motion";
import {
  Download,
  FolderOpen,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  Terminal,
  Cpu,
  Gpu,
  Zap,
  Package,
  SkipForward,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  detectGPU,
  getRecommendedConfig,
  alignConfig,
  completeSetup,
  skipSetup,
  type GPUDetectionResponse,
  type RecommendedConfigResponse,
  type ProfileInfo,
  type OptionalPackageInfo,
} from "@/api/client";

// --- Types ---

const WIZARD_STEPS = ["env", "env-progress", "detect", "profile", "extras", "install", "done"] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

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

// --- Electron API ---

const electronApi = (window as unknown as {
  electronApi?: {
    platform: string;
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

// --- Animation variants ---

const stepVariants = {
  enter: { opacity: 0, x: 30 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -30 },
};

// --- Visual progress mapping ---

const VISUAL_STEPS = ["env", "detect", "profile", "extras", "done"];

function getVisualIndex(step: WizardStep): number {
  switch (step) {
    case "env":
    case "env-progress":
      return 0;
    case "detect":
      return 1;
    case "profile":
      return 2;
    case "extras":
    case "install":
      return 3;
    case "done":
      return 4;
  }
}

// --- Helpers ---

function profileIcon(profileId: string) {
  if (profileId.includes("gpu") || profileId.includes("cuda") || profileId.includes("metal")) {
    return <Gpu className="h-5 w-5" />;
  }
  return <Cpu className="h-5 w-5" />;
}

function stepLabel(step: string, t: (key: string) => string): string {
  switch (step) {
    case "downloading": return t("setupWizard.envProgress.downloading");
    case "extracting": return t("setupWizard.envProgress.extracting");
    case "creating_venv": return t("setupWizard.envProgress.creatingVenv");
    case "installing": return t("setupWizard.envProgress.installing");
    case "validating": return t("setupWizard.envProgress.validating");
    case "starting": return t("setupWizard.envProgress.startingBackend");
    case "ready": return t("setupWizard.envProgress.ready");
    default: return t("setupWizard.envProgress.settingUp");
  }
}

// --- Component ---

interface EnvSetupProps {
  onComplete: () => void;
}

export default function EnvSetup({ onComplete }: EnvSetupProps) {
  const { t } = useTranslation();

  // Step management
  const [currentStep, setCurrentStep] = useState<WizardStep>("env");
  const [error, setError] = useState<string | null>(null);

  // Pre-backend state (env selection)
  const [detectedEnvs, setDetectedEnvs] = useState<DetectedEnv[]>([]);
  const [detectingEnvs, setDetectingEnvs] = useState(false);
  const [progress, setProgress] = useState<SetupProgress>({ percent: 0, step: "", detail: "" });

  // Post-backend state (profile + packages)
  const [gpuInfo, setGpuInfo] = useState<GPUDetectionResponse | null>(null);
  const [config, setConfig] = useState<RecommendedConfigResponse | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<string>("cpu");
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [installProgress, setInstallProgress] = useState(0);
  const [installMessage, setInstallMessage] = useState("");
  const [installError, setInstallError] = useState<string | null>(null);

  // Platform for filtering
  const platform = electronApi?.platform || "win32";

  // Detect existing envs on mount
  useEffect(() => {
    if (!electronApi) return;
    setDetectingEnvs(true);
    electronApi.detectExistingEnvs().then((envs) => {
      setDetectedEnvs(envs);
      setDetectingEnvs(false);
    }).catch(() => setDetectingEnvs(false));
  }, []);

  // Subscribe to env setup progress
  useEffect(() => {
    if (!electronApi) return;
    const cleanup = electronApi.onEnvSetupProgress((p) => {
      setProgress(p);
    });
    return cleanup;
  }, []);

  // --- Transition to post-backend steps ---

  const transitionToPostBackend = useCallback(async () => {
    setCurrentStep("detect");
    setError(null);

    try {
      const [gpuResult, configResult] = await Promise.all([
        detectGPU(),
        getRecommendedConfig(),
      ]);
      setGpuInfo(gpuResult);
      setConfig(configResult);

      // Auto-select recommended profile
      const recommended = gpuResult.recommended_profiles[0];
      if (recommended) setSelectedProfile(recommended);

      // Auto-advance after showing GPU info briefly
      setTimeout(() => setCurrentStep("profile"), 1500);
    } catch {
      // GPU detection or config fetch failed — advance to profile with defaults
      setCurrentStep("profile");
    }
  }, []);

  // --- Pre-backend handlers ---

  const handleAutoSetup = useCallback(async () => {
    if (!electronApi) return;
    setCurrentStep("env-progress");
    setError(null);
    setProgress({ percent: 0, step: "starting", detail: "Starting setup..." });

    const result = await electronApi.startEnvSetup();
    if (result.success) {
      await transitionToPostBackend();
    } else {
      setError(result.error || "Setup failed");
    }
  }, [transitionToPostBackend]);

  const handleUseExisting = useCallback(async (envPath: string) => {
    if (!electronApi) return;
    setCurrentStep("env-progress");
    setError(null);
    setProgress({ percent: 50, step: "validating", detail: "Validating environment..." });

    const result = await electronApi.useExistingEnv(envPath);
    if (result.success) {
      setProgress({ percent: 80, step: "starting", detail: "Starting backend..." });
      const backendResult = await electronApi.restartBackend();
      if (backendResult.success) {
        await transitionToPostBackend();
      } else {
        setError(backendResult.error || "Failed to start backend");
      }
    } else {
      setError(result.message);
    }
  }, [transitionToPostBackend]);

  const handleBrowsePython = useCallback(async () => {
    if (!electronApi) return;
    const pythonPath = await electronApi.selectPythonExe();
    if (!pythonPath) return;

    setCurrentStep("env-progress");
    setError(null);
    setProgress({ percent: 50, step: "validating", detail: "Validating Python executable..." });

    const result = await electronApi.useExistingPython(pythonPath);
    if (result.success) {
      setProgress({ percent: 80, step: "starting", detail: "Starting backend..." });
      const backendResult = await electronApi.restartBackend();
      if (backendResult.success) {
        await transitionToPostBackend();
      } else {
        setError(backendResult.error || "Failed to start backend");
      }
    } else {
      setError(result.message);
    }
  }, [transitionToPostBackend]);

  const handleRetryEnv = useCallback(() => {
    setCurrentStep("env");
    setError(null);
  }, []);

  // --- Post-backend handlers ---

  const handleInstall = useCallback(async () => {
    setCurrentStep("install");
    setInstallProgress(10);
    setInstallMessage(t("setupWizard.install.preparing"));
    setInstallError(null);

    try {
      setInstallMessage(t("setupWizard.install.installingProfile"));

      const result = await alignConfig({
        profile: selectedProfile,
        optional_packages: selectedExtras,
      });

      if (result.success) {
        setInstallProgress(100);
        setInstallMessage(t("setupWizard.install.complete"));
        await completeSetup(selectedProfile, selectedExtras);
        setTimeout(() => setCurrentStep("done"), 500);
      } else {
        setInstallError(result.message);
        setInstallProgress(100);
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : t("setupWizard.install.failed"));
      setInstallProgress(100);
    }
  }, [selectedProfile, selectedExtras, t]);

  const handleSkipInstall = useCallback(async () => {
    try {
      await completeSetup(selectedProfile);
    } catch { /* best effort */ }
    setCurrentStep("done");
  }, [selectedProfile]);

  const handleSkip = useCallback(async () => {
    try {
      await skipSetup();
    } catch { /* best effort */ }
    onComplete();
  }, [onComplete]);

  // --- Derived state ---

  const visualIndex = getVisualIndex(currentStep);

  const filteredProfiles = config?.profiles.filter(
    (p: ProfileInfo) => p.platforms.length === 0 || p.platforms.includes(platform),
  ) ?? [];

  // --- Render ---

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-xl">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">nirs4all Studio</h1>
          <p className="text-muted-foreground">{t("setupWizard.subtitle")}</p>
        </div>

        {/* Progress dots (hidden on env choice step) */}
        {currentStep !== "env" && (
          <div className="flex items-center justify-center gap-2 mb-8">
            {VISUAL_STEPS.map((_, i) => (
              <div key={i} className="flex items-center">
                <div
                  className={`w-2.5 h-2.5 rounded-full transition-colors ${
                    i <= visualIndex ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                />
                {i < VISUAL_STEPS.length - 1 && (
                  <div
                    className={`w-8 h-0.5 transition-colors ${
                      i < visualIndex ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2 }}
          >
            {/* ── Step 1: Environment Choice ── */}
            {currentStep === "env" && (
              <Card>
                <CardHeader className="text-center">
                  <CardTitle>{t("setupWizard.env.title")}</CardTitle>
                  <CardDescription>{t("setupWizard.env.description")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Auto setup */}
                  <Button
                    className="w-full h-auto py-4 flex-col items-start gap-1"
                    onClick={handleAutoSetup}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Download className="h-5 w-5 shrink-0" />
                      <span className="font-medium">{t("setupWizard.env.autoSetup")}</span>
                      <Badge variant="secondary" className="ml-auto">{t("setupWizard.env.recommended")}</Badge>
                    </div>
                    <span className="text-xs text-primary-foreground/70 pl-7">
                      {t("setupWizard.env.autoSetupDetail")}
                    </span>
                  </Button>

                  {/* Divider */}
                  <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">{t("setupWizard.env.or")}</span>
                    </div>
                  </div>

                  {/* Detected environments */}
                  {detectingEnvs ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground justify-center py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{t("setupWizard.env.scanning")}</span>
                    </div>
                  ) : detectedEnvs.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">
                        {t("setupWizard.env.detectedEnvs")}
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
                              {env.hasNirs4all && ` \u00b7 ${t("setupWizard.env.nirs4allInstalled")}`}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {/* Browse for python */}
                  <Button variant="outline" className="w-full" onClick={handleBrowsePython}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    {t("setupWizard.env.browsePython")}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* ── Step 2: Environment Setup Progress ── */}
            {currentStep === "env-progress" && (
              <Card>
                <CardHeader className="text-center">
                  <CardTitle className="flex items-center justify-center gap-2">
                    {error ? (
                      <AlertCircle className="h-5 w-5 text-destructive" />
                    ) : (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    )}
                    {error ? t("setupWizard.envProgress.failed") : t("setupWizard.envProgress.title")}
                  </CardTitle>
                  {!error && (
                    <CardDescription>{stepLabel(progress.step, t)}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {error ? (
                    <>
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                      <div className="flex justify-center">
                        <Button variant="outline" onClick={handleRetryEnv}>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          {t("setupWizard.envProgress.tryAgain")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Progress value={progress.percent} className="h-2" />
                      <p className="text-sm text-center text-muted-foreground">
                        {progress.detail}
                      </p>
                      <p className="text-xs text-center text-muted-foreground/60">
                        {t("setupWizard.envProgress.timeNote")}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Step 3: GPU Detection ── */}
            {currentStep === "detect" && (
              <Card>
                <CardHeader className="text-center">
                  <CardTitle className="flex items-center justify-center gap-2">
                    <Zap className="h-5 w-5" />
                    {t("setupWizard.detect.title")}
                  </CardTitle>
                  <CardDescription>{t("setupWizard.detect.description")}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-4">
                  {!gpuInfo ? (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">
                        {t("setupWizard.detect.scanning")}
                      </p>
                    </>
                  ) : (
                    <div className="text-center space-y-3">
                      {gpuInfo.has_cuda && (
                        <div className="flex items-center gap-2 justify-center">
                          <Gpu className="h-5 w-5 text-green-500" />
                          <span className="font-medium">NVIDIA GPU: {gpuInfo.gpu_name}</span>
                          {gpuInfo.cuda_version && (
                            <Badge variant="secondary">CUDA {gpuInfo.cuda_version}</Badge>
                          )}
                        </div>
                      )}
                      {gpuInfo.has_metal && (
                        <div className="flex items-center gap-2 justify-center">
                          <Gpu className="h-5 w-5 text-green-500" />
                          <span className="font-medium">Apple Metal (Apple Silicon)</span>
                        </div>
                      )}
                      {!gpuInfo.has_cuda && !gpuInfo.has_metal && (
                        <div className="flex items-center gap-2 justify-center">
                          <Cpu className="h-5 w-5 text-muted-foreground" />
                          <span className="text-muted-foreground">
                            {t("setupWizard.detect.noGpu")}
                          </span>
                        </div>
                      )}
                      <p className="text-sm text-muted-foreground mt-2">
                        {t("setupWizard.detect.autoAdvance")}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Step 4: Profile Selection ── */}
            {currentStep === "profile" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Cpu className="h-5 w-5" />
                    {t("setupWizard.profile.title")}
                  </CardTitle>
                  <CardDescription>{t("setupWizard.profile.description")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {filteredProfiles.length === 0 && !config ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    filteredProfiles.map((profile: ProfileInfo) => {
                      const isRecommended = gpuInfo?.recommended_profiles[0] === profile.id;
                      return (
                        <div
                          key={profile.id}
                          className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                            selectedProfile === profile.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                          onClick={() => setSelectedProfile(profile.id)}
                        >
                          {profileIcon(profile.id)}
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{profile.label}</span>
                              {isRecommended && (
                                <Badge variant="default" className="text-xs">
                                  {t("setupWizard.profile.recommended")}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {profile.description}
                            </p>
                            <div className="flex gap-1 mt-2 flex-wrap">
                              {Object.keys(profile.packages).map((pkg) => (
                                <Badge key={pkg} variant="outline" className="text-xs">
                                  {pkg}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div
                            className={`w-4 h-4 rounded-full border-2 mt-1 ${
                              selectedProfile === profile.id
                                ? "border-primary bg-primary"
                                : "border-muted-foreground/30"
                            }`}
                          />
                        </div>
                      );
                    })
                  )}

                  <div className="flex justify-between pt-4">
                    <Button variant="ghost" onClick={handleSkip}>
                      <SkipForward className="mr-2 h-4 w-4" />
                      {t("setupWizard.skip")}
                    </Button>
                    <Button onClick={() => setCurrentStep("extras")}>
                      {t("common.next")}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Step 5: Optional Extras ── */}
            {currentStep === "extras" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    {t("setupWizard.extras.title")}
                  </CardTitle>
                  <CardDescription>{t("setupWizard.extras.description")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {config?.optional.map((pkg: OptionalPackageInfo) => (
                    <div
                      key={pkg.name}
                      className="flex items-start gap-3 p-3 rounded-lg border"
                    >
                      <Checkbox
                        id={pkg.name}
                        checked={selectedExtras.includes(pkg.name)}
                        onCheckedChange={(checked) => {
                          setSelectedExtras((prev) =>
                            checked
                              ? [...prev, pkg.name]
                              : prev.filter((n) => n !== pkg.name),
                          );
                        }}
                      />
                      <div className="flex-1">
                        <Label htmlFor={pkg.name} className="font-medium cursor-pointer">
                          {pkg.name}
                          <Badge variant="outline" className="ml-2 text-xs">
                            {pkg.version}
                          </Badge>
                        </Label>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {pkg.description}
                        </p>
                      </div>
                    </div>
                  ))}

                  <div className="flex justify-between pt-4">
                    <Button variant="outline" onClick={() => setCurrentStep("profile")}>
                      <ChevronLeft className="mr-2 h-4 w-4" />
                      {t("common.back")}
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={handleSkipInstall}>
                        {t("setupWizard.extras.skipInstall")}
                      </Button>
                      <Button onClick={handleInstall}>
                        {t("setupWizard.extras.install")}
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Step 6: Installation Progress ── */}
            {currentStep === "install" && (
              <Card>
                <CardHeader className="text-center">
                  <CardTitle className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {t("setupWizard.install.title")}
                  </CardTitle>
                  <CardDescription>{t("setupWizard.install.description")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Progress value={installProgress} className="h-2" />
                  <p className="text-sm text-center text-muted-foreground">
                    {installMessage}
                  </p>

                  {installError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{installError}</AlertDescription>
                    </Alert>
                  )}

                  {installError && (
                    <div className="flex justify-center pt-2">
                      <Button variant="outline" onClick={handleSkipInstall}>
                        {t("setupWizard.install.continueAnyway")}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Step 7: Done ── */}
            {currentStep === "done" && (
              <Card>
                <CardHeader className="text-center">
                  <CardTitle className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    {t("setupWizard.ready.title")}
                  </CardTitle>
                  <CardDescription>{t("setupWizard.ready.description")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("setupWizard.ready.profile")}</span>
                      <span className="font-medium">{selectedProfile}</span>
                    </div>
                    {selectedExtras.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("setupWizard.ready.extras")}</span>
                        <span className="font-medium">{selectedExtras.length} packages</span>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-center pt-2">
                    <Button size="lg" onClick={onComplete}>
                      {t("setupWizard.ready.launch")}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
