import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { PythonRuntimeDisplayState } from "@/lib/pythonRuntimeDisplay";
import {
  shortenPath,
  shortVersion,
} from "./PythonEnvPickerLogic";

export interface BusyProgressState {
  title: string;
  detail: string;
  progress: number;
  ceiling: number;
}

export interface SwitchResult {
  success: boolean;
  message: string;
}

interface BusyProgressPanelProps {
  title: string;
  detail: string;
  progress: number;
}

export function BusyProgressPanel({
  title,
  detail,
  progress,
}: BusyProgressPanelProps) {
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

interface LoadingPanelProps {
  label: string;
  iconClassName?: string;
}

export function LoadingPanel({
  label,
  iconClassName = "h-5 w-5",
}: LoadingPanelProps) {
  return (
    <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
      <Loader2 className={`${iconClassName} animate-spin text-muted-foreground`} />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

interface PythonEnvStatusCardProps {
  isReady: boolean;
  runtimeVersion: string | null;
  runtimeDisplay: PythonRuntimeDisplayState;
  runningPythonPath: string | null;
  missingCoreCount: number;
  missingOptionalCount: number;
  isSettingUp: boolean;
  readyLabel: string;
  notReadyLabel: string;
  reviewPackagesLabel: string;
  changeLabel: string;
  onOpenReview: () => void;
  onOpenDialog: () => void | Promise<void>;
}

export function PythonEnvStatusCard({
  isReady,
  runtimeVersion,
  runtimeDisplay,
  runningPythonPath,
  missingCoreCount,
  missingOptionalCount,
  isSettingUp,
  readyLabel,
  notReadyLabel,
  reviewPackagesLabel,
  changeLabel,
  onOpenReview,
  onOpenDialog,
}: PythonEnvStatusCardProps) {
  const { t } = useTranslation();
  return (
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
              Python {shortVersion(runtimeVersion, t)}
            </span>
            <Badge variant={isReady ? "default" : "destructive"} className="text-xs">
              {isReady ? readyLabel : notReadyLabel}
            </Badge>
            {runtimeDisplay.label && (
              <Badge variant="secondary" className="text-xs">
                {runtimeDisplay.label}
              </Badge>
            )}
          </div>
          <div className="mt-1 space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("settings.pythonEnvPicker.runningPython")}</p>
            <p className="text-xs font-mono truncate" title={runningPythonPath ?? undefined}>
              {shortenPath(runningPythonPath, t)}
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {missingCoreCount > 0
              ? t("settings.pythonEnvPicker.missingCore", { count: missingCoreCount })
              : missingOptionalCount > 0
                ? t("settings.pythonEnvPicker.missingOptional", { count: missingOptionalCount })
                : t("settings.pythonEnvPicker.coreReady")}
          </p>
        </div>
      </div>
      <div className="ml-3 flex flex-shrink-0 flex-col gap-2 sm:flex-row">
        {isReady && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenReview}
            disabled={isSettingUp}
            title={t("settings.pythonEnvPicker.reviewPackagesHint")}
          >
            {reviewPackagesLabel}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void onOpenDialog();
          }}
          disabled={isSettingUp}
        >
          {changeLabel}
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

interface SetupProgressPanelProps {
  title: string;
  percent: number;
  detail: string;
}

export function SetupProgressPanel({
  title,
  percent,
  detail,
}: SetupProgressPanelProps) {
  return (
    <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm font-medium">{title}</span>
      </div>
      <Progress value={percent} className="h-2" />
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

interface RuntimeModeAlertsProps {
  runtimeDisplay: PythonRuntimeDisplayState;
}

export function RuntimeModeAlerts({ runtimeDisplay }: RuntimeModeAlertsProps) {
  const { t } = useTranslation();
  return (
    <>
      {runtimeDisplay.isBundledEmbedded && (
        <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription>
            {t("settings.pythonEnvPicker.modeEmbedded")}
          </AlertDescription>
        </Alert>
      )}

      {runtimeDisplay.isBundledExternal && (
        <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription>
            {t("settings.pythonEnvPicker.modeExternal")}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

interface SwitchResultAlertProps {
  result: SwitchResult | null;
  success: boolean;
}

export function SwitchResultAlert({
  result,
  success,
}: SwitchResultAlertProps) {
  if (!result || result.success !== success) {
    return null;
  }

  if (success) {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertDescription>{result.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{result.message}</AlertDescription>
    </Alert>
  );
}

interface SetupErrorAlertProps {
  error: string | null;
  isSettingUp: boolean;
}

export function SetupErrorAlert({
  error,
  isSettingUp,
}: SetupErrorAlertProps) {
  if (!error || isSettingUp) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}
