/**
 * Python Environment Picker
 *
 * VSCode-style environment selector for Settings.
 * Shows current Python env and lets the user switch quickly.
 * Only renders in Electron mode (env management via IPC).
 */

import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  LoadingPanel,
  PythonEnvStatusCard,
  RuntimeModeAlerts,
  SetupErrorAlert,
  SetupProgressPanel,
  SwitchResultAlert,
} from "./PythonEnvPickerPanels";
import {
  PythonEnvSelectionDialog,
  type PythonEnvSelectionLabels,
} from "./PythonEnvPickerSelectionDialog";
import {
  PythonRuntimeReviewDialog,
  type PythonRuntimeReviewLabels,
} from "./PythonEnvPickerReviewDialog";
import { PythonEnvPickerHeader } from "./PythonEnvPickerHeader";
import { usePythonEnvPickerController } from "./PythonEnvPickerController";

export function PythonEnvPicker() {
  const { t } = useTranslation();
  const controller = usePythonEnvPickerController();

  // Not in Electron: don't render
  if (!controller.electronApi) return null;

  const {
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
  } = controller;

  const {
    isReady,
    runningPythonPath,
    runtimeVersion,
    runtimeDisplay,
    missingCoreCount,
    missingOptionalCount,
    hasAlignmentPreview,
    alignmentChangesCount,
    reviewOptionalPackages,
  } = controller.runtimeView;
  const selectionLabels: PythonEnvSelectionLabels = {
    selectInterpreter: t("settings.pythonEnv.selectInterpreter"),
    selectInterpreterDesc: t("settings.pythonEnv.selectInterpreterDesc"),
    scanning: t("settings.pythonEnv.scanning"),
    detected: t("settings.pythonEnv.detected"),
    current: t("settings.pythonEnv.current"),
    noEnvsFound: t("settings.pythonEnv.noEnvsFound"),
    browseForPython: t("settings.pythonEnv.browseForPython"),
    createNew: t("settings.pythonEnv.createNew"),
    autoSetup: t("settings.pythonEnv.autoSetup"),
    createInFolder: t("settings.pythonEnv.createInFolder"),
  };
  const reviewLabels: PythonRuntimeReviewLabels = {
    default: t("common.default"),
    loading: t("common.loading"),
  };

  return (
    <Card>
      <PythonEnvPickerHeader
        title={t("settings.pythonEnv.title")}
        description={t("settings.pythonEnv.description")}
        refreshLabel={t("common.refresh")}
        isRefreshing={isLoading}
        isSettingUp={isSettingUp}
        onRefresh={loadEnvInfo}
      />
      <CardContent className="space-y-4">
        {isLoading ? (
          <LoadingPanel label={t("common.loading")} />
        ) : (
          <>
            <PythonEnvStatusCard
              isReady={isReady}
              runtimeVersion={runtimeVersion}
              runtimeDisplay={runtimeDisplay}
              runningPythonPath={runningPythonPath}
              missingCoreCount={missingCoreCount}
              missingOptionalCount={missingOptionalCount}
              isSettingUp={isSettingUp}
              readyLabel={t("settings.pythonEnv.ready")}
              notReadyLabel={t("settings.pythonEnv.notReady")}
              reviewPackagesLabel="Review packages"
              changeLabel={t("settings.pythonEnv.change")}
              onOpenReview={handleOpenReviewClick}
              onOpenDialog={handleOpenDialog}
            />

            <SwitchResultAlert result={switchResult} success />

            {isSettingUp && (
              <SetupProgressPanel
                title={t("settings.pythonEnv.settingUp")}
                percent={setupProgress.percent}
                detail={setupProgress.detail}
              />
            )}

            <SetupErrorAlert error={setupError} isSettingUp={isSettingUp} />
            <RuntimeModeAlerts runtimeDisplay={runtimeDisplay} />
            <SwitchResultAlert result={switchResult} success={false} />
          </>
        )}

        <PythonEnvSelectionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          labels={selectionLabels}
          switchProgressState={switchProgressState}
          inspection={inspection}
          isSwitching={isSwitching}
          isScanning={isScanning}
          detectedEnvs={detectedEnvs}
          runningPythonPath={runningPythonPath}
          onSelectDetectedEnv={handleSelectDetectedEnv}
          onBrowse={handleBrowse}
          onAutoSetup={handleAutoSetup}
          onCreateInFolder={handleCreateInFolder}
          onBackFromInspection={handleBackFromInspection}
          onUseInspectionAsIs={handleUseInspectionAsIs}
          onInstallCoreAndSwitch={handleInstallCoreAndSwitch}
        />

        <PythonRuntimeReviewDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          labels={reviewLabels}
          postSwitchValidation={postSwitchValidation}
          runningPythonPath={runningPythonPath}
          runtimeDisplay={runtimeDisplay}
          compatibleProfiles={compatibleProfiles}
          selectedReviewProfile={selectedReviewProfile}
          isAligning={isAligning}
          alignStatus={alignStatus}
          alignProgress={alignProgress}
          isReviewPreviewLoading={isReviewPreviewLoading}
          hasAlignmentPreview={hasAlignmentPreview}
          alignmentChangesCount={alignmentChangesCount}
          reviewError={reviewError}
          alignFailures={alignFailures}
          isReviewDetailsLoading={isReviewDetailsLoading}
          reviewProfileDiff={reviewProfileDiff}
          reviewDependencies={reviewDependencies}
          reviewOptionalPackages={reviewOptionalPackages}
          onUpdateReviewProfile={updateReviewProfile}
          onToggleReviewExtra={toggleReviewExtra}
          onAlignRuntime={handleAlignRuntime}
        />
      </CardContent>
    </Card>
  );
}
