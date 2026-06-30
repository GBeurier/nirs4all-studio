import {
  ChevronRight,
  Download,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { PythonEnvInspectionCard } from "@/components/python/PythonEnvInspectionCard";
import {
  getDesktopEnvKindLabel,
  getDesktopEnvWriteAccessLabel,
} from "@/lib/pythonRuntimeDisplay";
import type {
  DesktopDetectedEnv,
  DesktopInspectedEnv,
} from "@/types/pythonRuntime";
import { isSamePath } from "./PythonEnvPickerLogic";
import {
  BusyProgressPanel,
  LoadingPanel,
  type BusyProgressState,
} from "./PythonEnvPickerPanels";

export interface PythonEnvSelectionLabels {
  selectInterpreter: string;
  selectInterpreterDesc: string;
  scanning: string;
  detected: string;
  current: string;
  noEnvsFound: string;
  browseForPython: string;
  createNew: string;
  autoSetup: string;
  createInFolder: string;
}

interface PythonEnvSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: PythonEnvSelectionLabels;
  switchProgressState: BusyProgressState | null;
  inspection: DesktopInspectedEnv | null;
  isSwitching: boolean;
  isScanning: boolean;
  detectedEnvs: DesktopDetectedEnv[];
  runningPythonPath: string | null;
  onSelectDetectedEnv: (envPath: string) => void | Promise<void>;
  onBrowse: () => void | Promise<void>;
  onAutoSetup: () => void | Promise<void>;
  onCreateInFolder: () => void | Promise<void>;
  onBackFromInspection: () => void;
  onUseInspectionAsIs: () => void;
  onInstallCoreAndSwitch: () => void;
}

export function PythonEnvSelectionDialog({
  open,
  onOpenChange,
  labels,
  switchProgressState,
  inspection,
  isSwitching,
  isScanning,
  detectedEnvs,
  runningPythonPath,
  onSelectDetectedEnv,
  onBrowse,
  onAutoSetup,
  onCreateInFolder,
  onBackFromInspection,
  onUseInspectionAsIs,
  onInstallCoreAndSwitch,
}: PythonEnvSelectionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{labels.selectInterpreter}</DialogTitle>
          <DialogDescription>
            {labels.selectInterpreterDesc}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {switchProgressState && !inspection && (
            <BusyProgressPanel
              title={switchProgressState.title}
              detail={switchProgressState.detail}
              progress={switchProgressState.progress}
            />
          )}

          {inspection ? (
            <PythonEnvInspectionCard
              inspection={inspection}
              busy={isSwitching}
              busyTitle={switchProgressState?.title}
              busyDetail={switchProgressState?.detail}
              busyProgress={switchProgressState?.progress}
              onBack={onBackFromInspection}
              onUseAsIs={onUseInspectionAsIs}
              onInstallCoreAndSwitch={onInstallCoreAndSwitch}
            />
          ) : (
            <>
              {isScanning ? (
                <LoadingPanel label={labels.scanning} iconClassName="h-4 w-4" />
              ) : detectedEnvs.length > 0 ? (
                <DetectedEnvironmentList
                  detectedEnvs={detectedEnvs}
                  runningPythonPath={runningPythonPath}
                  isSwitching={isSwitching}
                  currentLabel={labels.current}
                  detectedLabel={labels.detected}
                  onSelectDetectedEnv={onSelectDetectedEnv}
                />
              ) : (
                <div className="p-4 bg-muted/50 rounded-lg text-sm text-muted-foreground">
                  {labels.noEnvsFound}
                </div>
              )}

              <Separator />

              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  void onBrowse();
                }}
                disabled={isSwitching}
              >
                {isSwitching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FolderOpen className="mr-2 h-4 w-4" />
                )}
                {labels.browseForPython}
              </Button>

              <Separator />

              <div className="space-y-2">
                <label className="text-sm font-medium">{labels.createNew}</label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      void onAutoSetup();
                    }}
                    disabled={isSwitching}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {labels.autoSetup}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      void onCreateInFolder();
                    }}
                    disabled={isSwitching}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    {labels.createInFolder}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface DetectedEnvironmentListProps {
  detectedEnvs: DesktopDetectedEnv[];
  runningPythonPath: string | null;
  isSwitching: boolean;
  currentLabel: string;
  detectedLabel: string;
  onSelectDetectedEnv: (envPath: string) => void | Promise<void>;
}

function DetectedEnvironmentList({
  detectedEnvs,
  runningPythonPath,
  isSwitching,
  currentLabel,
  detectedLabel,
  onSelectDetectedEnv,
}: DetectedEnvironmentListProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{detectedLabel}</label>
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {detectedEnvs.map((env) => {
          const isCurrent = runningPythonPath
            ? isSamePath(runningPythonPath, env.pythonPath)
            : false;
          return (
            <button
              key={env.pythonPath}
              onClick={() => {
                if (!isCurrent) {
                  void onSelectDetectedEnv(env.path);
                }
              }}
              disabled={isSwitching || !!isCurrent}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                isCurrent
                  ? "bg-primary/5 border-primary/30 cursor-default"
                  : "hover:bg-muted/70 cursor-pointer border-muted"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">
                    Python {env.pythonVersion}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {getDesktopEnvKindLabel(env.envKind)}
                  </Badge>
                  <Badge variant={env.hasCorePackages ? "outline" : "destructive"} className="text-xs">
                    {env.hasCorePackages ? "Core ready" : "Core missing"}
                  </Badge>
                  <Badge variant={env.writable ? "outline" : "secondary"} className="text-xs">
                    {getDesktopEnvWriteAccessLabel(env.writable)}
                  </Badge>
                  {isCurrent && (
                    <Badge variant="default" className="text-xs">{currentLabel}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate" title={env.path}>
                  Root: {env.path}
                </p>
                <p className="text-xs text-muted-foreground truncate" title={env.pythonPath}>
                  Executable: {env.pythonPath}
                </p>
              </div>
              {!isCurrent && <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
