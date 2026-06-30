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

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "@/lib/motion";
import {
  getSetupStatus,
  alignConfig,
  completeSetup,
  skipSetup,
  type GPUDetectionResponse,
  type RecommendedConfigResponse,
} from "@/api/config";
import {
  announceBackendRestarted,
  loadPostSwitchValidation,
  previewRuntimeAlignment,
  restartBackendForRuntimeSwitch,
} from "@/lib/pythonRuntimeSwitch";
import {
  buildEnvSetupViewState,
  checkedStateToBoolean,
  getEffectiveProfileExtras,
  pruneSelectedExtrasForVisiblePackages,
  updateExtraSelection,
  type EnvSummary,
  type EnvSetupCheckedState,
  type SetupProgress,
  type WizardStep,
} from "./EnvSetup.helpers";
import { EnvSetupEnvChoice } from "./EnvSetupEnvChoice";
import { EnvSetupProgressDots } from "./EnvSetupProgressDots";
import {
  EnvProgressStepCard,
  GpuDetectionStepCard,
  InstallProgressStepCard,
  OptionalExtrasStepCard,
  ProfileSelectionStepCard,
  ReadyStepCard,
} from "./EnvSetupStepCards";
import type { DesktopDetectedEnv, DesktopInspectedEnv } from "@/types/pythonRuntime";

// --- Electron API ---

const electronApi = (window as unknown as {
  electronApi?: {
    platform: string;
    isEnvReady: () => Promise<boolean>;
    startEnvSetup: (targetDir?: string) => Promise<{ success: boolean; error?: string }>;
    onEnvSetupProgress: (cb: (p: SetupProgress) => void) => () => void;
    detectExistingEnvs: () => Promise<DesktopDetectedEnv[]>;
    inspectExistingEnv: (path: string) => Promise<{ success: boolean; message: string; info?: DesktopInspectedEnv }>;
    applyExistingEnv: (
      path: string,
      options?: { installCorePackages?: boolean },
    ) => Promise<{ success: boolean; message: string; info?: DesktopInspectedEnv }>;
    selectFolder: () => Promise<string | null>;
    selectPythonExe: () => Promise<string | null>;
    inspectExistingPython: (path: string) => Promise<{ success: boolean; message: string; info?: DesktopInspectedEnv }>;
    applyExistingPython: (
      path: string,
      options?: { installCorePackages?: boolean },
    ) => Promise<{ success: boolean; message: string; info?: DesktopInspectedEnv }>;
    restartBackend: (options?: { skipEnsure?: boolean }) => Promise<{ success: boolean; error?: string }>;
    shouldShowWizard: () => Promise<boolean>;
    markWizardComplete: (skipNextTime: boolean) => Promise<void>;
    getCurrentEnvSummary: () => Promise<EnvSummary | null>;
    isPortable: () => Promise<boolean>;
  };
}).electronApi;

// --- Animation variants ---

const stepVariants = {
  enter: { opacity: 0, x: 30 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -30 },
};

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
  const [detectedEnvs, setDetectedEnvs] = useState<DesktopDetectedEnv[]>([]);
  const [inspection, setInspection] = useState<DesktopInspectedEnv | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [detectingEnvs, setDetectingEnvs] = useState(false);
  const [currentEnv, setCurrentEnv] = useState<EnvSummary | null>(null);
  const [progress, setProgress] = useState<SetupProgress>({ percent: 0, step: "", detail: "" });

  // Post-backend state (profile + packages)
  const [gpuInfo, setGpuInfo] = useState<GPUDetectionResponse | null>(null);
  const [config, setConfig] = useState<RecommendedConfigResponse | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<string>("cpu");
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [installProgress, setInstallProgress] = useState(0);
  const [installMessage, setInstallMessage] = useState("");
  const [installError, setInstallError] = useState<string | null>(null);

  // Portable mode state
  const [isPortableMode, setIsPortableMode] = useState(false);
  const [skipNextTime, setSkipNextTime] = useState(false);

  // Platform for filtering
  const platform = electronApi?.platform || "win32";

  // Detect existing envs and current env on mount
  useEffect(() => {
    if (!electronApi) return;
    setDetectingEnvs(true);

    // Fetch current env summary and detected envs in parallel
    Promise.all([
      electronApi.detectExistingEnvs(),
      electronApi.getCurrentEnvSummary(),
      electronApi.isPortable(),
    ]).then(([envs, summary, portable]) => {
      setDetectedEnvs(envs);
      setCurrentEnv(summary);
      setIsPortableMode(portable);
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

  const transitionToPostBackend = useCallback(async (validationPromise?: Promise<Awaited<ReturnType<typeof loadPostSwitchValidation>>>) => {
    setCurrentStep("detect");
    setError(null);

    // Give the backend a moment to fully initialize its routes after startup
    await new Promise((r) => setTimeout(r, 500));

    try {
      const validation = validationPromise
        ? await validationPromise
        : await loadPostSwitchValidation();

      setGpuInfo(validation.gpuInfo);
      setConfig(validation.config);
      setSelectedProfile(validation.selectedProfile);
      setSelectedExtras(validation.selectedExtras);

      // Brief pause to show GPU info, then advance to profile
      setTimeout(() => setCurrentStep("profile"), validation.gpuInfo ? 1500 : 300);
    } catch (err) {
      console.warn("[EnvSetup] Post-switch validation failed:", err);
      setError(err instanceof Error ? err.message : "Failed to inspect the selected runtime");
      setCurrentStep("env-progress");
    }
  }, []);

  // --- Pre-backend handlers ---

  const handleUseCurrent = useCallback(async () => {
    if (!electronApi) return;
    setCurrentStep("env-progress");
    setError(null);
    setProgress({ percent: 60, step: "starting", detail: "Starting backend..." });

    // Current env is already configured — just start/restart the backend
    try {
      const validation = await restartBackendForRuntimeSwitch((options) => electronApi.restartBackend(options));
      // Get previous profile, then actually verify packages are installed.
      // Both endpoints are file/disk-based and do not need ML imports, so they
      // are safe to call right after restartBackend() returns. Any error here
      // is logged (not silently swallowed) so the fall-through to the full
      // setup flow is debuggable.
      try {
        const setupStatus = await getSetupStatus();
        if (setupStatus.selected_profile) {
          const extras = getEffectiveProfileExtras(
            validation.selectedExtras,
            validation.config,
            setupStatus.selected_profile,
          );
          const dryRun = await previewRuntimeAlignment(setupStatus.selected_profile, extras);
          if (dryRun?.success && dryRun.installed.length === 0) {
            // Packages are aligned — skip to done
            setConfig(validation.config);
            setSelectedProfile(setupStatus.selected_profile);
            setSelectedExtras(extras);
            setCurrentStep("done");
            return;
          }
        }
      } catch (err) {
        console.warn("[EnvSetup] Fast-path setup check failed, falling back to full flow:", err);
      }

      await transitionToPostBackend(Promise.resolve(validation));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start backend");
    }
  }, [transitionToPostBackend]);

  const handleAutoSetup = useCallback(async () => {
    if (!electronApi) return;
    setCurrentStep("env-progress");
    setError(null);
    setProgress({ percent: 0, step: "starting", detail: "Starting setup..." });

    const result = await electronApi.startEnvSetup();
    if (result.success) {
      announceBackendRestarted();
      await transitionToPostBackend(Promise.resolve(loadPostSwitchValidation()));
    } else {
      setError(result.error || "Setup failed");
    }
  }, [transitionToPostBackend]);

  const handleCreateInFolder = useCallback(async () => {
    if (!electronApi) return;
    const folder = await electronApi.selectFolder();
    if (!folder) return;

    setCurrentStep("env-progress");
    setError(null);
    setProgress({ percent: 0, step: "starting", detail: "Starting setup..." });

    const result = await electronApi.startEnvSetup(folder);
    if (result.success) {
      announceBackendRestarted();
      await transitionToPostBackend(Promise.resolve(loadPostSwitchValidation()));
    } else {
      setError(result.error || "Setup failed");
    }
  }, [transitionToPostBackend]);

  const handleInspectExisting = useCallback(async (envPath: string) => {
    if (!electronApi) return;
    setError(null);
    setIsInspecting(true);
    try {
      const result = await electronApi.inspectExistingEnv(envPath);
      if (result.success && result.info) {
        setInspection(result.info);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to inspect environment");
    } finally {
      setIsInspecting(false);
    }
  }, []);

  const handleBrowsePython = useCallback(async () => {
    if (!electronApi) return;
    const pythonPath = await electronApi.selectPythonExe();
    if (!pythonPath) return;

    setError(null);
    setIsInspecting(true);
    try {
      const result = await electronApi.inspectExistingPython(pythonPath);
      if (result.success && result.info) {
        setInspection(result.info);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to inspect Python executable");
    } finally {
      setIsInspecting(false);
    }
  }, []);

  const handleApplyInspection = useCallback(async (installCorePackages: boolean) => {
    if (!electronApi || !inspection) return;

    setCurrentStep("env-progress");
    setError(null);
    setProgress({
      percent: 50,
      step: "validating",
      detail: installCorePackages
        ? "Installing core backend packages..."
        : "Applying selected Python runtime...",
    });

    const result = await electronApi.applyExistingPython(inspection.pythonPath, {
      installCorePackages,
    });
    if (!result.success) {
      setError(result.message);
      return;
    }

    setProgress({ percent: 80, step: "starting", detail: "Starting backend..." });
    try {
      const validation = await restartBackendForRuntimeSwitch((options) => electronApi.restartBackend(options));
      setInspection(null);
      await transitionToPostBackend(Promise.resolve(validation));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start backend");
    }
  }, [inspection, transitionToPostBackend]);

  const handleRetryEnv = useCallback(() => {
    setCurrentStep("env");
    setInspection(null);
    setError(null);
  }, []);

  // --- Derived state ---

  const {
    profiles: filteredProfiles,
    profileOptionalPackages,
    effectiveExtras,
  } = useMemo(
    () => buildEnvSetupViewState({
      config,
      platform,
      selectedExtras,
      selectedProfile,
    }),
    [config, platform, selectedExtras, selectedProfile],
  );

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
        optional_packages: effectiveExtras,
      });

      if (result.success) {
        setInstallProgress(100);
        setInstallMessage(t("setupWizard.install.complete"));
        await completeSetup(selectedProfile, effectiveExtras);
        setTimeout(() => setCurrentStep("done"), 500);
      } else {
        setInstallError(result.message);
        setInstallProgress(100);
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : t("setupWizard.install.failed"));
      setInstallProgress(100);
    }
  }, [effectiveExtras, selectedProfile, t]);

  const handleSkipInstall = useCallback(async () => {
    try {
      await completeSetup(selectedProfile);
    } catch { /* best effort */ }
    setCurrentStep("done");
  }, [selectedProfile]);

  const handleSkip = useCallback(async () => {
    try {
      await skipSetup();
      // Stamp the wizard as completed for the current app version so it does
      // not re-appear on the next launch. The "Don't ask again" preference
      // (skipNextTime) is forwarded too, in case the user toggled it on the
      // final step before clicking the install-skip button.
      electronApi?.markWizardComplete(skipNextTime);
    } catch { /* best effort */ }
    onComplete();
  }, [onComplete, skipNextTime]);

  const handleReconfigure = useCallback(() => {
    transitionToPostBackend();
  }, [transitionToPostBackend]);

  const handleToggleExtra = useCallback((packageName: string, checked: EnvSetupCheckedState) => {
    setSelectedExtras((prev) => updateExtraSelection(prev, packageName, checked));
  }, []);

  const handleSkipNextTimeChange = useCallback((checked: EnvSetupCheckedState) => {
    setSkipNextTime(checkedStateToBoolean(checked));
  }, []);

  const handleLaunch = useCallback(async () => {
    try {
      await electronApi?.markWizardComplete(skipNextTime);
    } catch { /* best effort */ }
    onComplete();
  }, [onComplete, skipNextTime]);

  useEffect(() => {
    setSelectedExtras((prev) => pruneSelectedExtrasForVisiblePackages(prev, config));
  }, [config]);

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
        <EnvSetupProgressDots currentStep={currentStep} />

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
              <EnvSetupEnvChoice
                currentEnv={currentEnv}
                detectedEnvs={detectedEnvs}
                detectingEnvs={detectingEnvs}
                error={error}
                inspection={inspection}
                isInspecting={isInspecting}
                onApplyInspection={handleApplyInspection}
                onAutoSetup={handleAutoSetup}
                onBrowsePython={handleBrowsePython}
                onClearInspection={() => setInspection(null)}
                onCreateInFolder={handleCreateInFolder}
                onInspectExisting={handleInspectExisting}
                onUseCurrent={handleUseCurrent}
              />
            )}

            {/* ── Step 2: Environment Setup Progress ── */}
            {currentStep === "env-progress" && (
              <EnvProgressStepCard
                error={error}
                onRetry={handleRetryEnv}
                progress={progress}
              />
            )}

            {/* ── Step 3: GPU Detection ── */}
            {currentStep === "detect" && (
              <GpuDetectionStepCard gpuInfo={gpuInfo} />
            )}

            {/* ── Step 4: Profile Selection ── */}
            {currentStep === "profile" && (
              <ProfileSelectionStepCard
                config={config}
                gpuInfo={gpuInfo}
                onNext={() => setCurrentStep("extras")}
                onRetry={transitionToPostBackend}
                onSelectProfile={setSelectedProfile}
                onSkip={handleSkip}
                profiles={filteredProfiles}
                selectedProfile={selectedProfile}
              />
            )}

            {/* ── Step 5: Optional Extras ── */}
            {currentStep === "extras" && (
              <OptionalExtrasStepCard
                onBack={() => setCurrentStep("profile")}
                onInstall={handleInstall}
                onSkipInstall={handleSkipInstall}
                onToggleExtra={handleToggleExtra}
                packages={profileOptionalPackages}
                selectedExtras={selectedExtras}
              />
            )}

            {/* ── Step 6: Installation Progress ── */}
            {currentStep === "install" && (
              <InstallProgressStepCard
                installError={installError}
                installMessage={installMessage}
                installProgress={installProgress}
                onSkipInstall={handleSkipInstall}
              />
            )}

            {/* ── Step 7: Done ── */}
            {currentStep === "done" && (
              <ReadyStepCard
                effectiveExtras={effectiveExtras}
                isPortableMode={isPortableMode}
                onLaunch={handleLaunch}
                onReconfigure={handleReconfigure}
                onSkipNextTimeChange={handleSkipNextTimeChange}
                selectedProfile={selectedProfile}
                skipNextTime={skipNextTime}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
