import { AlertCircle, ChevronDown, HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { RuntimeInfo } from "@/api/updates";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import type { PythonRuntimeDisplayState } from "@/lib/pythonRuntimeDisplay";

import type { TextDisplay } from "./UpdatesSectionLogic";

type RuntimeStatusPanelProps = {
  currentRuntime: RuntimeInfo | null;
  gpuDisplay: TextDisplay;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  packageCount: number;
  runtimeDisplay: Pick<PythonRuntimeDisplayState, "label">;
  runtimeExecutablePath: string;
  runtimeSizeLabel: string;
  torchDisplay: TextDisplay | null;
};

function RuntimeTextValue({ value }: { value: TextDisplay }) {
  if (value.muted) {
    return <span className="text-muted-foreground">{value.label}</span>;
  }

  return value.label;
}

export function RuntimeStatusPanel({
  currentRuntime,
  gpuDisplay,
  isLoading,
  onOpenChange,
  open,
  packageCount,
  runtimeDisplay,
  runtimeExecutablePath,
  runtimeSizeLabel,
  torchDisplay,
}: RuntimeStatusPanelProps) {
  const { t } = useTranslation();
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-2 h-auto">
          <span className="text-sm font-medium flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            {t("settings.updates.runtime.title")}
          </span>
          <div className="flex items-center gap-2">
            {currentRuntime?.is_valid ? (
              <Badge variant="outline" className="text-green-600">{t("settings.pythonEnv.ready")}</Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600">{t("settings.updates.runtime.unavailable")}</Badge>
            )}
            <Badge variant="secondary" className="text-xs">{runtimeDisplay.label}</Badge>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-3">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : currentRuntime?.is_valid ? (
          <div className="space-y-2 p-3 bg-muted/30 rounded-lg text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("settings.updates.runtime.python")}</span>
              <span className="font-mono">{currentRuntime.python_version}</span>
            </div>
            <div className="flex justify-between items-start gap-4">
              <span className="text-muted-foreground">{t("settings.updates.runtime.runtime")}</span>
              <span className="text-right max-w-[60%]">{runtimeDisplay.label}</span>
            </div>
            <div className="flex justify-between items-start gap-4">
              <span className="text-muted-foreground">{t("settings.updates.runtime.executable")}</span>
              <span className="font-mono text-xs break-all text-right max-w-[60%]">
                {runtimeExecutablePath}
              </span>
            </div>
            <div className="flex justify-between items-start gap-4">
              <span className="text-muted-foreground">{t("settings.updates.runtime.gpu")}</span>
              <span className="text-right max-w-[60%]">
                <RuntimeTextValue value={gpuDisplay} />
              </span>
            </div>
            {torchDisplay && (
              <div className="flex justify-between items-start gap-4">
                <span className="text-muted-foreground">{t("settings.updates.runtime.torch")}</span>
                <span className="text-right max-w-[60%]">
                  <RuntimeTextValue value={torchDisplay} />
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("settings.updates.runtime.size")}</span>
              <span>{runtimeSizeLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("settings.updates.runtime.packages")}</span>
              <span>{t("settings.updates.runtime.packagesInstalled", { count: packageCount })}</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground">{t("settings.updates.runtime.root")}</span>
              <span className="font-mono text-xs break-all text-right max-w-[60%]">
                {currentRuntime.path}
              </span>
            </div>
          </div>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {t("settings.updates.runtime.invalid")}
            </AlertDescription>
          </Alert>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
