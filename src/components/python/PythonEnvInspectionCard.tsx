import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Download,
  HardDrive,
  Loader2,
  Package,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getDesktopEnvKindLabel, getDesktopEnvWriteAccessLabel } from "@/lib/pythonRuntimeDisplay";
import type { DesktopInspectedEnv } from "@/types/pythonRuntime";

interface PythonEnvInspectionCardProps {
  inspection: DesktopInspectedEnv;
  busy?: boolean;
  busyTitle?: string;
  busyDetail?: string;
  busyProgress?: number;
  onBack: () => void;
  onUseAsIs: () => void;
  onInstallCoreAndSwitch: () => void;
}

export function PythonEnvInspectionCard({
  inspection,
  busy = false,
  busyTitle,
  busyDetail,
  busyProgress = 20,
  onBack,
  onUseAsIs,
  onInstallCoreAndSwitch,
}: PythonEnvInspectionCardProps) {
  const { t } = useTranslation();
  const coreReady = inspection.missingCorePackages.length === 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">Python {inspection.pythonVersion}</span>
          <Badge variant="outline" className="text-xs">
            {coreReady ? t("common.pythonEnv.inspection.nirs4allAvailable") : t("common.pythonEnv.inspection.nirs4allUpdateNeeded")}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {getDesktopEnvKindLabel(inspection.envKind)}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {getDesktopEnvWriteAccessLabel(inspection.writable)}
          </Badge>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("common.pythonEnv.inspection.executable")}</p>
          <p className="text-xs font-mono break-all">{inspection.pythonPath}</p>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("common.pythonEnv.inspection.root")}</p>
          <p className="text-xs font-mono break-all">{inspection.path}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <HardDrive className="h-3.5 w-3.5" />
              {t("common.pythonEnv.inspection.runtime")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {inspection.hasNirs4all ? t("common.pythonEnv.inspection.nirs4allInstalled") : t("common.pythonEnv.inspection.nirs4allMissing")}
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Package className="h-3.5 w-3.5" />
              {t("common.pythonEnv.inspection.optionalFeatures")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("common.pythonEnv.inspection.optionalMissing", { count: inspection.missingOptionalPackages.length })}
            </p>
          </div>

        </div>

        {coreReady ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription>
              {t("common.pythonEnv.inspection.verifyNote")}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {t("common.pythonEnv.inspection.installNote", { packages: inspection.missingCorePackages.join(", ") })}
            </AlertDescription>
          </Alert>
        )}

        {busy && (
          <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm font-medium">{busyTitle ?? t("common.pythonEnv.inspection.busyTitle")}</span>
            </div>
            <Progress value={busyProgress} className="h-2" />
            <p className="text-xs text-muted-foreground">{busyDetail ?? t("common.pythonEnv.inspection.busyDetail")}</p>
          </div>
        )}
      </div>

      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          <ChevronLeft className="mr-2 h-4 w-4" />
          {t("common.back")}
        </Button>
        {coreReady ? (
          <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onInstallCoreAndSwitch} disabled={busy}>
            {t("common.pythonEnv.inspection.updateAndUse")}
          </Button>
          <Button onClick={onUseAsIs} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            {busy ? t("common.pythonEnv.inspection.applying") : t("common.pythonEnv.inspection.useThis")}
          </Button>
          </div>
        ) : (
          <Button onClick={onInstallCoreAndSwitch} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {busy ? t("common.pythonEnv.inspection.installingCore") : t("common.pythonEnv.inspection.updateAndUse")}
          </Button>
        )}
      </div>
    </div>
  );
}
