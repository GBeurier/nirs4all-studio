import { useTranslation } from "react-i18next";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PyTorchNeed } from "@/lib/pytorchRequirement";
import type { PythonEnvActivity } from "@/types/pythonEnvironment";
import { PythonEnvActivityStatus } from "./PythonEnvActivityStatus";

export type PyTorchInstallStatus = "asking" | "installing" | "failed";

export interface PyTorchInstallDialogProps {
  open: boolean;
  need: PyTorchNeed;
  status: PyTorchInstallStatus;
  /** Path of the environment PyTorch is installed into. */
  environmentPath: string | null;
  /** Progress of the running installation. */
  activity: PythonEnvActivity | undefined;
  /** Why the last installation failed. */
  failure: string | null;
  onInstall: () => void;
  /** Declines the installation, or leaves a running one in the background. */
  onDismiss: () => void;
}

/** Asks before PyTorch is installed for a neural-network model, then follows the installation. */
export function PyTorchInstallDialog({
  open,
  need,
  status,
  environmentPath,
  activity,
  failure,
  onInstall,
  onDismiss,
}: PyTorchInstallDialogProps) {
  const { t } = useTranslation();
  const name = need.kind === "model" ? need.name : undefined;
  const installing = status === "installing";
  const reason = need.kind === "model"
    ? t("pythonEnv.pytorch.needModel", { name })
    : t("pythonEnv.pytorch.needExperiment", { count: need.pipelines.length, pipelines: need.pipelines.join(", ") });

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDismiss(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t(installing ? "pythonEnv.pytorch.installingTitle" : "pythonEnv.pytorch.title")}</DialogTitle>
          <DialogDescription>{reason}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {environmentPath && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
              <dt className="text-muted-foreground">{t("pythonEnv.pytorch.environment")}</dt>
              <dd className="break-all font-mono text-xs leading-5">{environmentPath}</dd>
            </dl>
          )}
          {installing ? (
            <>
              <PythonEnvActivityStatus activity={activity} />
              <p className="text-muted-foreground">{t("pythonEnv.pytorch.backgroundHint")}</p>
            </>
          ) : (
            <p className="text-muted-foreground">{t("pythonEnv.pytorch.cost")}</p>
          )}
          <p className="text-muted-foreground">
            {t(need.kind === "model" ? "pythonEnv.pytorch.thenModel" : "pythonEnv.pytorch.thenExperiment", { name })}
          </p>
          {need.kind === "experiment" && !installing && (
            <p className="text-muted-foreground">{t("pythonEnv.pytorch.declineExperiment")}</p>
          )}
          {status === "failed" && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t("pythonEnv.pytorch.failedTitle")}</AlertTitle>
              <AlertDescription className="break-words">{failure}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          {installing ? (
            <Button type="button" variant="outline" onClick={onDismiss}>{t("pythonEnv.pytorch.background")}</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onDismiss}>{t("pythonEnv.pytorch.notNow")}</Button>
              <Button type="button" onClick={onInstall}>
                {status === "failed"
                  ? <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                  : <Download className="mr-2 h-4 w-4" aria-hidden="true" />}
                {t(status === "failed" ? "common.retry" : "pythonEnv.pytorch.install")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
