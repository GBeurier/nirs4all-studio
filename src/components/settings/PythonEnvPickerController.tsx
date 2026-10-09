import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  alignConfig,
  type PackageFailure,
} from "@/api/config";
import { filterPackageNamesForProfile } from "@/lib/setup-config";
import type {
  DesktopDetectedEnv,
  DesktopEnvActionResult,
  DesktopInspectedEnv,
  PostSwitchValidation,
} from "@/types/pythonRuntime";
import {
  derivePythonEnvRuntimeView,
  resolveReviewProfileSelection,
} from "./PythonEnvPickerViewState";
import type {
  BusyProgressState,
  SwitchResult,
} from "./PythonEnvPickerPanels";
import {
  announceBackendRestarted,
  getElectronApi,
  getErrorMessage,
  loadPostSwitchValidation,
  loadRuntimeReviewDetails,
  loadRuntimeSnapshot,
  previewRuntimeAlignment,
  type ConfigComparisonResponse,
  type DependenciesResponse,
  type EnvInfo,
  type RuntimeSummaryResponse,
  type SetupProgress,
} from "./PythonEnvPickerRuntime";

function getInitialAlignStatus(t: TFunction): Pick<BusyProgressState, "title" | "detail"> {
  return {
    title: t("settings.pythonEnvPicker.aligningTitle"),
    detail: t("settings.pythonEnvPicker.aligningDetail"),
  };
}

export function usePythonEnvPickerController() {
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
  const [switchResult, setSwitchResult] = useState<SwitchResult | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [alignFailures, setAlignFailures] = useState<PackageFailure[]>([]);
  const [isAligning, setIsAligning] = useState(false);
  const [alignProgress, setAlignProgress] = useState(14);
  const [alignStatus, setAlignStatus] = useState<Pick<BusyProgressState, "title" | "detail">>(() => getInitialAlignStatus(t));

  const [isSettingUp, setIsSettingUp] = useState(false);
  const [setupProgress, setSetupProgress] = useState<SetupProgress>({ percent: 0, step: "", detail: "" });
  const [setupError, setSetupError] = useState<string | null>(null);

  const loadEnvInfo = useCallback(async () => {
    if (!electronApi) return;
    try {
      setIsLoading(true);
      const snapshot = await loadRuntimeSnapshot(electronApi);
      setEnvInfo(snapshot.envInfo);
      setRuntimeSummary(snapshot.runtimeSummary);
    } catch {
      // Silently fail - component shows fallback.
    } finally {
      setIsLoading(false);
    }
  }, [electronApi]);

  const loadReviewDetails = useCallback(async (profileId: string) => {
    try {
      setIsReviewDetailsLoading(true);
      const { profileDiff, dependencies } = await loadRuntimeReviewDetails(profileId);
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

  useEffect(() => {
    if (!electronApi || !isSettingUp) return;
    return electronApi.onEnvSetupProgress(setSetupProgress);
  }, [electronApi, isSettingUp]);

  const hasSwitchProgressState = switchProgressState !== null;
  const switchProgressCeiling = switchProgressState?.ceiling;

  useEffect(() => {
    if (!isSwitching || !hasSwitchProgressState) {
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
  }, [isSwitching, hasSwitchProgressState, switchProgressCeiling]);

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

  const { compatibleProfiles, selectedReviewProfile } = resolveReviewProfileSelection(
    postSwitchValidation,
    electronApi?.platform,
  );

  useEffect(() => {
    if (!reviewOpen || !postSwitchValidation?.runtimeSummary?.core_ready || !selectedReviewProfile) {
      return;
    }

    let cancelled = false;
    setIsReviewPreviewLoading(true);
    void previewRuntimeAlignment(
      selectedReviewProfile,
      filterPackageNamesForProfile(
        postSwitchValidation.selectedExtras,
        postSwitchValidation.config,
        selectedReviewProfile,
      ),
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
    postSwitchValidation?.config,
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

  const handleOpenDialog = useCallback(async () => {
    if (!electronApi) return;
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
  }, [electronApi]);

  useEffect(() => {
    const choose = () => { void handleOpenDialog(); };
    window.addEventListener("choose-python-environment", choose);
    return () => window.removeEventListener("choose-python-environment", choose);
  }, [handleOpenDialog]);

  const handleInspectResult = useCallback((result: DesktopEnvActionResult, fallbackMessage: string) => {
    if (result.success && result.info) {
      setInspection(result.info);
      return;
    }

    setSwitchResult({
      success: false,
      message: result.message || fallbackMessage,
    });
  }, []);

  const handleSelectDetectedEnv = useCallback(async (envPath: string) => {
    if (!electronApi) return;
    try {
      beginSwitchProgress(
        t("settings.pythonEnvPicker.inspectingEnv"),
        t("settings.pythonEnvPicker.inspectingEnvDetail"),
        18,
        48,
      );
      setSwitchResult(null);
      const result = await electronApi.inspectExistingEnv(envPath);
      handleInspectResult(result, t("settings.pythonEnvPicker.inspectFailed"));
    } catch (err) {
      setSwitchResult({
        success: false,
        message: getErrorMessage(err, t("settings.pythonEnvPicker.inspectFailed")),
      });
    } finally {
      finishSwitchProgress();
    }
  }, [beginSwitchProgress, electronApi, finishSwitchProgress, handleInspectResult, t]);

  const handleBrowse = useCallback(async () => {
    if (!electronApi) return;
    const pythonPath = await electronApi.selectPythonExe();
    if (!pythonPath) return;
    try {
      beginSwitchProgress(
        t("settings.pythonEnvPicker.inspectingExe"),
        t("settings.pythonEnvPicker.inspectingExeDetail"),
        18,
        48,
      );
      setSwitchResult(null);
      const result = await electronApi.inspectExistingPython(pythonPath);
      handleInspectResult(result, t("settings.pythonEnvPicker.inspectFailed"));
    } catch (err) {
      setSwitchResult({
        success: false,
        message: getErrorMessage(err, t("settings.pythonEnvPicker.inspectFailed")),
      });
    } finally {
      finishSwitchProgress();
    }
  }, [beginSwitchProgress, electronApi, finishSwitchProgress, handleInspectResult, t]);

  const handleApplyInspection = useCallback(async (installCorePackages: boolean) => {
    if (!electronApi || !inspection) {
      return;
    }

    try {
      beginSwitchProgress(
        installCorePackages ? t("settings.pythonEnvPicker.installingCore") : t("settings.pythonEnvPicker.applyingRuntime"),
        installCorePackages
          ? t("settings.pythonEnvPicker.installingCoreDetail")
          : t("settings.pythonEnvPicker.applyingRuntimeDetail"),
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
        t("settings.pythonEnvPicker.verifyingEnv"),
        t("settings.pythonEnvPicker.verifyingEnvDetail"),
        86,
        96,
      );
      announceBackendRestarted();
      const validation = await loadPostSwitchValidation();
      setPostSwitchValidation(validation);
      setReviewProfileDiff(null);
      setReviewDependencies(null);
      setDialogOpen(false);
      setInspection(null);
      setSwitchResult({ success: true, message: result.message });
      await loadEnvInfo();
    } catch (err) {
      setSwitchResult({
        success: false,
        message: getErrorMessage(err, t("settings.pythonEnvPicker.switchFailed")),
      });
    } finally {
      finishSwitchProgress();
    }
  }, [
    beginSwitchProgress,
    electronApi,
    finishSwitchProgress,
    inspection,
    loadEnvInfo,
    t,
    updateSwitchProgress,
  ]);

  const handleSetup = useCallback(async (targetDir?: string) => {
    if (!electronApi) return;
    setDialogOpen(false);
    setIsSettingUp(true);
    setSetupError(null);
    setSetupProgress({ percent: 0, step: "starting", detail: t("settings.pythonEnvPicker.startingSetup") });

    try {
      const result = await electronApi.startEnvSetup(targetDir);
      if (result.success) {
        announceBackendRestarted();
        const validation = await loadPostSwitchValidation();
        setPostSwitchValidation(validation);
        setReviewProfileDiff(null);
        setReviewDependencies(null);
        setSwitchResult({ success: true, message: t("settings.pythonEnvPicker.envCreated") });
        await loadEnvInfo();
      } else {
        setSetupError(result.error || t("settings.pythonEnvPicker.setupFailed"));
      }
    } catch (err) {
      setSetupError(getErrorMessage(err, t("settings.pythonEnvPicker.setupFailed")));
    } finally {
      setIsSettingUp(false);
    }
  }, [electronApi, loadEnvInfo, t]);

  const handleAutoSetup = useCallback(() => {
    void handleSetup();
  }, [handleSetup]);

  const handleCreateInFolder = useCallback(async () => {
    if (!electronApi) return;
    const folder = await electronApi.selectFolder();
    if (!folder) return;
    await handleSetup(folder);
  }, [electronApi, handleSetup]);

  const handleOpenReview = useCallback(async () => {
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
      setReviewError(getErrorMessage(err, t("settings.pythonEnvPicker.reviewLoadFailed")));
    }
  }, [loadReviewDetails, postSwitchValidation, t]);

  const handleOpenReviewClick = useCallback(() => {
    void handleOpenReview();
  }, [handleOpenReview]);

  const updateReviewProfile = useCallback((profileId: string) => {
    setReviewError(null);
    setPostSwitchValidation((prev) => prev ? { ...prev, selectedProfile: profileId } : prev);
  }, []);

  const toggleReviewExtra = useCallback((packageName: string) => {
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
  }, []);

  const handleAlignRuntime = useCallback(async () => {
    if (!electronApi || !postSwitchValidation) {
      return;
    }

    try {
      setIsAligning(true);
      setAlignProgress(18);
      setAlignStatus(getInitialAlignStatus(t));
      setReviewError(null);
      setAlignFailures([]);

      const result = await alignConfig({
        profile: selectedReviewProfile,
        optional_packages: filterPackageNamesForProfile(
          postSwitchValidation.selectedExtras,
          postSwitchValidation.config,
          selectedReviewProfile,
        ),
      });
      if (!result.success) {
        setReviewError(result.message);
        setAlignFailures(result.failures ?? []);
        return;
      }

      if (result.requires_restart) {
        setAlignProgress(96);
        setAlignStatus({
          title: t("settings.pythonEnvPicker.verifyingEnv"),
          detail: t("settings.pythonEnvPicker.alignVerifyDetail"),
        });

        const restartResult = await electronApi.restartBackend({ skipEnsure: true });
        if (!restartResult.success) {
          setReviewError(restartResult.error || t("settings.pythonEnvPicker.alignRestartFailed"));
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
      announceBackendRestarted();
      setReviewError(getErrorMessage(err, t("settings.pythonEnvPicker.alignFailed")));
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
  }, [
    electronApi,
    loadEnvInfo,
    loadReviewDetails,
    postSwitchValidation,
    selectedReviewProfile,
    t,
  ]);

  const runtimeView = derivePythonEnvRuntimeView({
    runtimeSummary,
    envInfo,
    postSwitchValidation,
    selectedReviewProfile,
  });

  const handleBackFromInspection = useCallback(() => {
    setInspection(null);
  }, []);

  const handleUseInspectionAsIs = useCallback(() => {
    void handleApplyInspection(false);
  }, [handleApplyInspection]);

  const handleInstallCoreAndSwitch = useCallback(() => {
    void handleApplyInspection(true);
  }, [handleApplyInspection]);

  return {
    electronApi,
    isLoading,
    dialogOpen,
    setDialogOpen,
    reviewOpen,
    setReviewOpen,
    detectedEnvs,
    inspection,
    postSwitchValidation,
    reviewProfileDiff,
    reviewDependencies,
    isReviewDetailsLoading,
    isReviewPreviewLoading,
    isScanning,
    isSwitching,
    switchProgressState,
    switchResult,
    reviewError,
    alignFailures,
    isAligning,
    alignProgress,
    alignStatus,
    isSettingUp,
    setupProgress,
    setupError,
    compatibleProfiles,
    selectedReviewProfile,
    runtimeView,
    environmentError: envInfo?.error,
    loadEnvInfo,
    handleOpenDialog,
    handleSelectDetectedEnv,
    handleBrowse,
    handleAutoSetup,
    handleCreateInFolder,
    handleOpenReviewClick,
    updateReviewProfile,
    toggleReviewExtra,
    handleAlignRuntime,
    handleBackFromInspection,
    handleUseInspectionAsIs,
    handleInstallCoreAndSwitch,
  };
}
