import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Download,
  FolderOpen,
  Loader2,
  Terminal,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PythonEnvInspectionCard } from "@/components/python/PythonEnvInspectionCard";
import { getDesktopEnvKindLabel, getDesktopEnvWriteAccessLabel } from "@/lib/pythonRuntimeDisplay";
import type { DesktopDetectedEnv, DesktopInspectedEnv } from "@/types/pythonRuntime";
import type { EnvSummary } from "./EnvSetup.helpers";

interface EnvSetupEnvChoiceProps {
  currentEnv: EnvSummary | null;
  detectedEnvs: DesktopDetectedEnv[];
  detectingEnvs: boolean;
  error: string | null;
  inspection: DesktopInspectedEnv | null;
  isInspecting: boolean;
  onApplyInspection: (installCorePackages: boolean) => void | Promise<void>;
  onAutoSetup: () => void | Promise<void>;
  onBrowsePython: () => void | Promise<void>;
  onClearInspection: () => void;
  onCreateInFolder: () => void | Promise<void>;
  onInspectExisting: (envPath: string) => void | Promise<void>;
  onUseCurrent: () => void | Promise<void>;
}

interface EnvChoiceDividerProps {
  label: string;
}

function EnvChoiceDivider({ label }: EnvChoiceDividerProps) {
  return (
    <div className="relative py-2">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-background px-2 text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

interface CurrentEnvironmentButtonProps {
  currentEnv: EnvSummary;
  onUseCurrent: () => void | Promise<void>;
}

function CurrentEnvironmentButton({ currentEnv, onUseCurrent }: CurrentEnvironmentButtonProps) {
  const { t } = useTranslation();

  return (
    <button
      className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-primary bg-primary/5 hover:bg-primary/10 transition-colors text-left"
      onClick={onUseCurrent}
    >
      <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{t("setupWizard.env.currentEnv")}</span>
          <Badge variant="default" className="text-xs">{t("setupWizard.env.recommended")}</Badge>
        </div>
        <p className="text-sm text-muted-foreground truncate mt-0.5">{currentEnv.envPath}</p>
        <p className="text-xs text-muted-foreground">Python {currentEnv.version}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

interface AutoSetupButtonProps {
  hasCurrentEnv: boolean;
  onAutoSetup: () => void | Promise<void>;
}

function AutoSetupButton({ hasCurrentEnv, onAutoSetup }: AutoSetupButtonProps) {
  const { t } = useTranslation();

  return (
    <Button
      variant={hasCurrentEnv ? "outline" : "default"}
      className="w-full h-auto py-4 flex-col items-start gap-1"
      onClick={onAutoSetup}
    >
      <div className="flex items-center gap-2 w-full">
        <Download className="h-5 w-5 shrink-0" />
        <span className="font-medium">{t("setupWizard.env.autoSetup")}</span>
        {!hasCurrentEnv && (
          <Badge variant="secondary" className="ml-auto">{t("setupWizard.env.recommended")}</Badge>
        )}
      </div>
      <span className={`text-xs pl-7 ${hasCurrentEnv ? "text-muted-foreground" : "text-primary-foreground/70"}`}>
        {t("setupWizard.env.autoSetupDetail")}
      </span>
    </Button>
  );
}

interface DetectedEnvironmentButtonProps {
  env: DesktopDetectedEnv;
  onInspectExisting: (envPath: string) => void | Promise<void>;
}

function DetectedEnvironmentButton({ env, onInspectExisting }: DetectedEnvironmentButtonProps) {
  return (
    <button
      className="w-full flex items-center gap-3 p-3 rounded-lg border hover:border-primary/50 hover:bg-accent/50 transition-colors text-left"
      onClick={() => {
        void onInspectExisting(env.path);
      }}
    >
      <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium truncate">Python {env.pythonVersion}</p>
          <Badge variant="secondary" className="text-xs">{getDesktopEnvKindLabel(env.envKind)}</Badge>
          <Badge variant={env.hasCorePackages ? "outline" : "destructive"} className="text-xs">
            {env.hasCorePackages ? "Core ready" : "Core missing"}
          </Badge>
          <Badge variant={env.writable ? "outline" : "secondary"} className="text-xs">
            {getDesktopEnvWriteAccessLabel(env.writable)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate" title={env.path}>
          Root: {env.path}
        </p>
        <p className="text-xs text-muted-foreground truncate" title={env.pythonPath}>
          Executable: {env.pythonPath}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

interface DetectedEnvironmentListProps {
  detectedEnvs: DesktopDetectedEnv[];
  detectingEnvs: boolean;
  isInspecting: boolean;
  onInspectExisting: (envPath: string) => void | Promise<void>;
}

function DetectedEnvironmentList({
  detectedEnvs,
  detectingEnvs,
  isInspecting,
  onInspectExisting,
}: DetectedEnvironmentListProps) {
  const { t } = useTranslation();

  if (detectingEnvs || isInspecting) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground justify-center py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t("setupWizard.env.scanning")}</span>
      </div>
    );
  }

  if (detectedEnvs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">
        {t("setupWizard.env.detectedEnvs")}
      </p>
      {detectedEnvs.map((env) => (
        <DetectedEnvironmentButton
          key={env.pythonPath}
          env={env}
          onInspectExisting={onInspectExisting}
        />
      ))}
    </div>
  );
}

export function EnvSetupEnvChoice({
  currentEnv,
  detectedEnvs,
  detectingEnvs,
  error,
  inspection,
  isInspecting,
  onApplyInspection,
  onAutoSetup,
  onBrowsePython,
  onClearInspection,
  onCreateInFolder,
  onInspectExisting,
  onUseCurrent,
}: EnvSetupEnvChoiceProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>{t("setupWizard.env.title")}</CardTitle>
        <CardDescription>{t("setupWizard.env.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {inspection ? (
          <PythonEnvInspectionCard
            inspection={inspection}
            busy={isInspecting}
            onBack={onClearInspection}
            onUseAsIs={() => {
              void onApplyInspection(false);
            }}
            onInstallCoreAndSwitch={() => {
              void onApplyInspection(true);
            }}
          />
        ) : (
          <>
            {currentEnv && (
              <>
                <CurrentEnvironmentButton currentEnv={currentEnv} onUseCurrent={onUseCurrent} />
                <EnvChoiceDivider label={t("setupWizard.env.changeEnv")} />
              </>
            )}

            <AutoSetupButton hasCurrentEnv={Boolean(currentEnv)} onAutoSetup={onAutoSetup} />

            {!currentEnv && (
              <EnvChoiceDivider label={t("setupWizard.env.or")} />
            )}

            <DetectedEnvironmentList
              detectedEnvs={detectedEnvs}
              detectingEnvs={detectingEnvs}
              isInspecting={isInspecting}
              onInspectExisting={onInspectExisting}
            />

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onBrowsePython}>
                <FolderOpen className="mr-2 h-4 w-4" />
                {t("setupWizard.env.browsePython")}
              </Button>
              <Button variant="outline" className="flex-1" onClick={onCreateInFolder}>
                <Download className="mr-2 h-4 w-4" />
                {t("setupWizard.env.createInFolder")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
