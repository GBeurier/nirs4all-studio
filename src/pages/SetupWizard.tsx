/**
 * First-Launch Setup Wizard
 *
 * Multi-step wizard presented at first launch to configure:
 * 1. GPU detection and compute profile selection
 * 2. Optional package selection
 * 3. Installation progress
 * 4. Completion
 */

import { useState, useEffect } from "react";
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
import { alignConfig } from "@/api/client";
import type { ProfileInfo, OptionalPackageInfo } from "@/api/client";

const electronApi = (window as unknown as { electronApi?: { platform: string } }).electronApi;

const STEPS = ["detect", "profile", "extras", "install", "ready"] as const;
type Step = (typeof STEPS)[number];

const stepVariants = {
  enter: { opacity: 0, x: 30 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -30 },
};

export default function SetupWizard() {
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
  }, [gpuInfo, gpuLoading]);

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

    try {
      // Simulate progress stages
      setInstallProgress(10);
      setInstallMessage(t("setupWizard.install.installingProfile"));

      const result = await alignConfig({
        profile: selectedProfile,
        optional_packages: selectedExtras,
      });

      if (result.success) {
        setInstallProgress(100);
        setInstallMessage(t("setupWizard.install.complete"));

        // Mark setup as complete
        completeSetupMutation.mutate({
          profile: selectedProfile,
          optionalPackages: selectedExtras,
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
    if (profileId.includes("gpu") || profileId.includes("cuda") || profileId.includes("metal")) {
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
                    config?.profiles
                    .filter((profile: ProfileInfo) => {
                      const platform = electronApi?.platform;
                      if (!platform) return true;
                      return profile.platforms.length === 0 || profile.platforms.includes(platform);
                    })
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
                        <Label
                          htmlFor={pkg.name}
                          className="font-medium cursor-pointer"
                        >
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
                    {selectedExtras.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t("setupWizard.ready.extras")}
                        </span>
                        <span className="font-medium">
                          {selectedExtras.length} packages
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
