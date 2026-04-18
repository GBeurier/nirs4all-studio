import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Download,
  HardDrive,
  Loader2,
  Package,
  ShieldAlert,
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
  busyTitle = "Working...",
  busyDetail = "Please wait while the selected environment is prepared.",
  busyProgress = 20,
  onBack,
  onUseAsIs,
  onInstallCoreAndSwitch,
}: PythonEnvInspectionCardProps) {
  const coreReady = inspection.missingCorePackages.length === 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">Python {inspection.pythonVersion}</span>
          <Badge variant={coreReady ? "default" : "destructive"} className="text-xs">
            {coreReady ? "Core ready" : "Core missing"}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {getDesktopEnvKindLabel(inspection.envKind)}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {getDesktopEnvWriteAccessLabel(inspection.writable)}
          </Badge>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Python executable</p>
          <p className="text-xs font-mono break-all">{inspection.pythonPath}</p>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Environment root</p>
          <p className="text-xs font-mono break-all">{inspection.path}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <HardDrive className="h-3.5 w-3.5" />
              Runtime
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {inspection.hasNirs4all ? "nirs4all installed" : "nirs4all missing"}
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Package className="h-3.5 w-3.5" />
              Optional gaps
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {inspection.missingOptionalPackages.length} package{inspection.missingOptionalPackages.length === 1 ? "" : "s"} missing
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <ShieldAlert className="h-3.5 w-3.5" />
              Profile guess
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {inspection.profileAlignmentGuess
                ? `${inspection.profileAlignmentGuess.label} (${inspection.profileAlignmentGuess.missingCount} gap${inspection.profileAlignmentGuess.missingCount === 1 ? "" : "s"})`
                : "Unavailable"}
            </p>
          </div>
        </div>

        {coreReady ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription>
              This Python can start the backend as-is. Optional profile packages can be reviewed later from Settings.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Missing core backend packages: {inspection.missingCorePackages.join(", ")}. The app will only install them if you confirm the explicit install action below.
            </AlertDescription>
          </Alert>
        )}

        {busy && (
          <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm font-medium">{busyTitle}</span>
            </div>
            <Progress value={busyProgress} className="h-2" />
            <p className="text-xs text-muted-foreground">{busyDetail}</p>
          </div>
        )}
      </div>

      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          <ChevronLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        {coreReady ? (
          <Button onClick={onUseAsIs} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            {busy ? "Applying runtime..." : "Use as-is"}
          </Button>
        ) : (
          <Button onClick={onInstallCoreAndSwitch} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {busy ? "Installing core packages..." : "Install Core Packages"}
          </Button>
        )}
      </div>
    </div>
  );
}
