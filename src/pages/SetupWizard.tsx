/**
 * First-Launch Setup Wizard
 *
 * Multi-step wizard presented at first launch to configure:
 * 1. GPU detection and compute profile selection
 * 2. Optional package selection
 * 3. Installation progress
 * 4. Completion
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "@/lib/motion";
import {
  Cpu,
  Gpu,
  Zap,
  Package,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  SkipForward,
  AlertCircle,
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
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useRecommendedConfig,
  useGPUDetection,
  useCompleteSetup,
  useSkipSetup,
} from "@/hooks/useRecommendedConfig";
import { alignConfig, getConfigDiff } from "@/api/config";
import { getDependencies } from "@/api/dependencies";
import { getRuntimeSummary } from "@/api/system";
import { api, formatApiErrorDetail } from "@/api/transport";
import type { ProfileInfo, OptionalPackageInfo } from "@/api/config";
import {
  filterOptionalPackagesForProfile,
  filterPackageNamesForProfile,
  getCompatibleProfiles,
  getPreselectedOptionalPackageNames,
  getVisibleOptionalPackages,
} from "@/lib/setup-config";

const electronApi = (window as unknown as { electronApi?: { platform: string } }).electronApi;

const STEPS = ["detect", "profile", "extras", "install", "ready"] as const;
type Step = (typeof STEPS)[number];

const stepVariants = {
  enter: { opacity: 0, x: 30 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -30 },
};

function setupErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "detail" in error) {
    const status = "status" in error && typeof error.status === "number" ? error.status : undefined;
    return formatApiErrorDetail(error.detail, status);
  }
  return fallback;
}

export default function SetupWizard() {
  const navigate = useNavigate();
  const completeSetupMutation = useCompleteSetup();
  const [mode, setMode] = useState<"checking" | "writable" | "packaged">("checking");
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verifyRuntime = useCallback(async (forceRefresh = false) => {
    setChecking(true);
    setReady(false);
    setError(null);
    try {
      const inventory = await getDependencies(forceRefresh);
      if (inventory.read_only !== true) {
        setMode("writable");
        return false;
      }
      setMode("packaged");
      const [diff, runtime, readiness] = await Promise.all([
        getConfigDiff("cpu", false, false),
        getRuntimeSummary(),
        api.get<{ ml_ready?: boolean; ml_error?: string | null }>("/system/readiness"),
      ]);
      if (!inventory.runtime_valid || !runtime.core_ready || !runtime.coherent) {
        throw new Error("The included Python runtime is not ready. Repair or reinstall Studio, then retry verification.");
      }
      if (readiness.ml_ready !== true) {
        throw new Error(readiness.ml_error || "The scientific runtime is not ready. Repair or reinstall Studio, then retry verification.");
      }
      if (!diff.is_aligned) {
        const packages = diff.packages.filter((pkg) => pkg.status === "missing" || pkg.status === "outdated");
        throw new Error(`Required packages are missing or incompatible: ${packages.map((pkg) => pkg.name).join(", ")}. Repair or reinstall Studio, then retry verification.`);
      }
      setReady(true);
      return true;
    } catch (err) {
      setError(setupErrorMessage(err, "Failed to verify the installed runtime"));
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void verifyRuntime(); }, [verifyRuntime]);

  const finishPackagedSetup = async () => {
    // The completion endpoint validates the runtime before persisting setup.
    // Repeating every inventory request here adds another cold-start cycle.
    if (!ready || checking) return;
    try {
      await completeSetupMutation.mutateAsync({ profile: "cpu" });
      navigate("/datasets", { replace: true });
    } catch (err) {
      setError(setupErrorMessage(err, "Failed to save setup completion"));
    }
  };

  if (mode === "writable") return <WritableSetupWizard />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Verify Studio installation</CardTitle>
          <CardDescription>Studio includes its Python runtime and CPU packages. Verify the installation before opening your datasets.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {checking && <p role="status">Checking the installed runtime and required packages…</p>}
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {ready && !checking && <p role="status">The included CPU runtime and required packages are ready.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => void verifyRuntime(true)} disabled={checking || completeSetupMutation.isPending}>Retry verification</Button>
            <Button onClick={() => void finishPackagedSetup()} disabled={!ready || checking || completeSetupMutation.isPending}>Open Studio</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WritableSetupWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState<Step>("detect");
  const [selectedProfile, setSelectedProfile] = useState<string>("cpu");
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [installProgress, setInstallProgress] = useState(0);
  const [installMessage, setInstallMessage] = useState("");
  const [installError, setInstallError] = useState<string | null>(null);

  const { data: config, isLoading: configLoading } = useRecommendedConfig();
  const { data: gpuInfo, isLoading: gpuLoading } = useGPUDetection();
  const completeSetupMutation = useCompleteSetup();
  const skipSetupMutation = useSkipSetup();

  // Pre-check optional packages already installed in the environment
  useEffect(() => {
    if (!config || configLoading) return;
    let cancelled = false;
    setSelectedExtras(getPreselectedOptionalPackageNames(config));

    getDependencies().then((deps) => {
      if (cancelled) {
        return;
      }

      const installedNames = deps.categories
        .flatMap((cat) => cat.packages)
        .filter((pkg) => pkg.is_installed)
        .map((pkg) => pkg.name);

      setSelectedExtras(getPreselectedOptionalPackageNames(config, installedNames));
    }).catch(() => {
      if (!cancelled) {
        setSelectedExtras(getPreselectedOptionalPackageNames(config));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [config, configLoading]);

  // Auto-select recommended profile based on GPU detection
  useEffect(() => {
    if (gpuInfo && !gpuLoading) {
      const recommended = gpuInfo.recommended_profiles[0];
      if (recommended) {
        setSelectedProfile(recommended);
      }
      // Auto-advance from detect step after GPU detection completes
      if (currentStep === "detect") {
        const timer = setTimeout(() => setCurrentStep("profile"), 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [currentStep, gpuInfo, gpuLoading]);

  const visibleOptionalPackages = getVisibleOptionalPackages(config);
  // Hide optionals the selected profile excludes (cpu-lite never offers torch/umap-learn)
  // and ignore any stale selections of them when installing or summarizing.
  const profileOptionalPackages = filterOptionalPackagesForProfile(visibleOptionalPackages, config, selectedProfile);
  const effectiveExtras = filterPackageNamesForProfile(selectedExtras, config, selectedProfile);

  useEffect(() => {
    const visiblePackages = getVisibleOptionalPackages(config);
    if (visiblePackages.length === 0) {
      setSelectedExtras([]);
      return;
    }
    const visibleNames = new Set(visiblePackages.map((pkg) => pkg.name));
    setSelectedExtras((prev) => prev.filter((name) => visibleNames.has(name)));
  }, [config]);

  const currentStepIndex = STEPS.indexOf(currentStep);

  const goNext = () => {
    const next = STEPS[currentStepIndex + 1];
    if (next) setCurrentStep(next);
  };

  const goBack = () => {
    const prev = STEPS[currentStepIndex - 1];
    if (prev) setCurrentStep(prev);
  };

  const handleSkip = async () => {
    skipSetupMutation.mutate(undefined, {
      onSuccess: () => navigate("/datasets", { replace: true }),
    });
  };

  const handleInstall = async () => {
    setCurrentStep("install");
    setInstallProgress(0);
    setInstallMessage(t("setupWizard.install.preparing"));
    setInstallError(null);

    // Never send optionals the selected profile excludes (e.g. torch on cpu-lite).
    const extras = filterPackageNamesForProfile(selectedExtras, config, selectedProfile);

    try {
      // Simulate progress stages
      setInstallProgress(10);
      setInstallMessage(t("setupWizard.install.installingProfile"));

      const result = await alignConfig({
        profile: selectedProfile,
        optional_packages: extras,
      });

      if (result.success) {
        setInstallProgress(100);
        setInstallMessage(t("setupWizard.install.complete"));

        // Mark setup as complete
        completeSetupMutation.mutate({
          profile: selectedProfile,
          optionalPackages: extras,
        });

        setTimeout(() => setCurrentStep("ready"), 500);
      } else {
        setInstallError(result.message);
        setInstallProgress(100);
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : t("setupWizard.install.failed"));
      setInstallProgress(100);
    }
  };

  const handleFinish = () => {
    navigate("/datasets", { replace: true });
  };

  const handleSkipInstall = async () => {
    // Complete setup without installing extras
    completeSetupMutation.mutate(
      { profile: selectedProfile },
      { onSuccess: () => setCurrentStep("ready") },
    );
  };

  const profileIcon = (profileId: string) => {
    if (profileId.includes("gpu") || profileId.includes("cuda") || profileId.includes("mps")) {
      return <Gpu className="h-5 w-5" />;
    }
    return <Cpu className="h-5 w-5" />;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            {t("setupWizard.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("setupWizard.subtitle")}
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center">
              <div
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  i <= currentStepIndex
                    ? "bg-primary"
                    : "bg-muted-foreground/30"
                }`}
              />
              {i < STEPS.length - 1 && (
                <div
                  className={`w-8 h-0.5 transition-colors ${
                    i < currentStepIndex
                      ? "bg-primary"
                      : "bg-muted-foreground/30"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

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
            {/* Step 1: GPU Detection */}
            {currentStep === "detect" && (
              <Card>
                <CardHeader className="text-center">
                  <CardTitle className="flex items-center justify-center gap-2">
                    <Zap className="h-5 w-5" />
                    {t("setupWizard.detect.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("setupWizard.detect.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-4">
                  {gpuLoading ? (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">
                        {t("setupWizard.detect.scanning")}
                      </p>
                    </>
                  ) : gpuInfo ? (
                    <div className="text-center space-y-3">
                      {gpuInfo.has_cuda && (
                        <div className="flex items-center gap-2 justify-center">
                          <Gpu className="h-5 w-5 text-green-500" />
                          <span className="font-medium">
                            NVIDIA GPU: {gpuInfo.gpu_name}
                          </span>
                          {gpuInfo.cuda_version && (
                            <Badge variant="secondary">
                              CUDA {gpuInfo.cuda_version}
                            </Badge>
                          )}
                        </div>
                      )}
                      {gpuInfo.has_metal && (
                        <div className="flex items-center gap-2 justify-center">
                          <Gpu className="h-5 w-5 text-green-500" />
                          <span className="font-medium">
                            Apple Metal (Apple Silicon)
                          </span>
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
                  ) : null}
                </CardContent>
              </Card>
            )}

            {/* Step 2: Profile Selection */}
            {currentStep === "profile" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Cpu className="h-5 w-5" />
                    {t("setupWizard.profile.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("setupWizard.profile.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {configLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    getCompatibleProfiles(config, electronApi?.platform)
                    .map((profile: ProfileInfo) => {
                      const isRecommended =
                        gpuInfo?.recommended_profiles[0] === profile.id;
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
                              <span className="font-medium">
                                {profile.label}
                              </span>
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
                                <Badge
                                  key={pkg}
                                  variant="outline"
                                  className="text-xs"
                                >
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
                    <Button onClick={goNext}>
                      {t("common.next")}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 3: Optional Extras */}
            {currentStep === "extras" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    {t("setupWizard.extras.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("setupWizard.extras.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {profileOptionalPackages.map((pkg: OptionalPackageInfo) => (
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
                        <Label
                          htmlFor={pkg.name}
                          className="font-medium cursor-pointer"
                        >
                          {pkg.name}
                          {pkg.default_install && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                              {t("common.default")}
                            </Badge>
                          )}
                          <Badge variant="outline" className="ml-2 text-xs">
                            {pkg.recommended || pkg.min}
                          </Badge>
                        </Label>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {pkg.description}
                        </p>
                      </div>
                    </div>
                  ))}

                  <div className="flex justify-between pt-4">
                    <Button variant="outline" onClick={goBack}>
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

            {/* Step 4: Installation Progress */}
            {currentStep === "install" && (
              <Card>
                <CardHeader className="text-center">
                  <CardTitle className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {t("setupWizard.install.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("setupWizard.install.description")}
                  </CardDescription>
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

            {/* Step 5: Ready */}
            {currentStep === "ready" && (
              <Card>
                <CardHeader className="text-center">
                  <CardTitle className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    {t("setupWizard.ready.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("setupWizard.ready.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {t("setupWizard.ready.profile")}
                      </span>
                      <span className="font-medium">{selectedProfile}</span>
                    </div>
                    {effectiveExtras.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t("setupWizard.ready.extras")}
                        </span>
                        <span className="font-medium">
                          {effectiveExtras.length} packages
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-center pt-2">
                    <Button size="lg" onClick={handleFinish}>
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
