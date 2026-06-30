import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Gpu,
  Loader2,
  Package,
  RefreshCw,
  SkipForward,
  Zap,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import type {
  GPUDetectionResponse,
  OptionalPackageInfo,
  ProfileInfo,
  RecommendedConfigResponse,
} from "@/api/config";
import {
  getStepLabelKey,
  isGpuProfile,
  isRecommendedProfile,
  type EnvSetupCheckedState,
  type SetupProgress,
} from "./EnvSetup.helpers";

interface EnvProgressStepCardProps {
  error: string | null;
  onRetry: () => void;
  progress: SetupProgress;
}

export function EnvProgressStepCard({ error, onRetry, progress }: EnvProgressStepCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2">
          {error ? (
            <AlertCircle className="h-5 w-5 text-destructive" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin" />
          )}
          {error ? t("setupWizard.envProgress.failed") : t("setupWizard.envProgress.title")}
        </CardTitle>
        {!error && (
          <CardDescription>{t(getStepLabelKey(progress.step))}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <div className="flex justify-center">
              <Button variant="outline" onClick={onRetry}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("setupWizard.envProgress.tryAgain")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Progress value={progress.percent} className="h-2" />
            <p className="text-sm text-center text-muted-foreground">
              {progress.detail}
            </p>
            <p className="text-xs text-center text-muted-foreground/60">
              {t("setupWizard.envProgress.timeNote")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface GpuDetectionStepCardProps {
  gpuInfo: GPUDetectionResponse | null;
}

export function GpuDetectionStepCard({ gpuInfo }: GpuDetectionStepCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2">
          <Zap className="h-5 w-5" />
          {t("setupWizard.detect.title")}
        </CardTitle>
        <CardDescription>{t("setupWizard.detect.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {!gpuInfo ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {t("setupWizard.detect.scanning")}
            </p>
          </>
        ) : (
          <div className="text-center space-y-3">
            {gpuInfo.has_cuda && (
              <div className="flex items-center gap-2 justify-center">
                <Gpu className="h-5 w-5 text-green-500" />
                <span className="font-medium">NVIDIA GPU: {gpuInfo.gpu_name}</span>
                {gpuInfo.cuda_version && (
                  <Badge variant="secondary">CUDA {gpuInfo.cuda_version}</Badge>
                )}
              </div>
            )}
            {gpuInfo.has_metal && (
              <div className="flex items-center gap-2 justify-center">
                <Gpu className="h-5 w-5 text-green-500" />
                <span className="font-medium">Apple Metal (Apple Silicon)</span>
              </div>
            )}
            {!gpuInfo.has_cuda && !gpuInfo.has_metal && (
              <div className="flex items-center gap-2 justify-center">
                <Cpu className="h-5 w-5 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {t("setupWizard.detect.noGpu")}
                </span>
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              {t("setupWizard.detect.autoAdvance")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function profileIcon(profileId: string) {
  return isGpuProfile(profileId) ? <Gpu className="h-5 w-5" /> : <Cpu className="h-5 w-5" />;
}

interface ProfileSelectionStepCardProps {
  config: RecommendedConfigResponse | null;
  gpuInfo: GPUDetectionResponse | null;
  onNext: () => void;
  onRetry: () => void | Promise<void>;
  onSelectProfile: (profileId: string) => void;
  onSkip: () => void | Promise<void>;
  profiles: ProfileInfo[];
  selectedProfile: string;
}

export function ProfileSelectionStepCard({
  config,
  gpuInfo,
  onNext,
  onRetry,
  onSelectProfile,
  onSkip,
  profiles,
  selectedProfile,
}: ProfileSelectionStepCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          {t("setupWizard.profile.title")}
        </CardTitle>
        <CardDescription>{t("setupWizard.profile.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {profiles.length === 0 && !config ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("setupWizard.profile.loadFailed")}</p>
            <Button variant="outline" size="sm" onClick={() => {
              void onRetry();
            }}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("common.retry")}
            </Button>
          </div>
        ) : (
          profiles.map((profile: ProfileInfo) => {
            const isRecommended = isRecommendedProfile(gpuInfo, profile.id);
            return (
              <div
                key={profile.id}
                className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                  selectedProfile === profile.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
                onClick={() => onSelectProfile(profile.id)}
              >
                {profileIcon(profile.id)}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{profile.label}</span>
                    {isRecommended && (
                      <Badge variant="default" className="text-xs">
                        {t("setupWizard.profile.recommended")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {profile.description}
                  </p>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {Object.keys(profile.packages).map((pkg) => (
                      <Badge key={pkg} variant="outline" className="text-xs">
                        {pkg}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div
                  className={`w-4 h-4 rounded-full border-2 mt-1 ${
                    selectedProfile === profile.id
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/30"
                  }`}
                />
              </div>
            );
          })
        )}

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onSkip}>
            <SkipForward className="mr-2 h-4 w-4" />
            {t("setupWizard.skip")}
          </Button>
          <Button onClick={onNext}>
            {t("common.next")}
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface OptionalExtrasStepCardProps {
  onBack: () => void;
  onInstall: () => void | Promise<void>;
  onSkipInstall: () => void | Promise<void>;
  onToggleExtra: (packageName: string, checked: EnvSetupCheckedState) => void;
  packages: OptionalPackageInfo[];
  selectedExtras: string[];
}

export function OptionalExtrasStepCard({
  onBack,
  onInstall,
  onSkipInstall,
  onToggleExtra,
  packages,
  selectedExtras,
}: OptionalExtrasStepCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          {t("setupWizard.extras.title")}
        </CardTitle>
        <CardDescription>{t("setupWizard.extras.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {packages.map((pkg: OptionalPackageInfo) => (
          <div
            key={pkg.name}
            className="flex items-start gap-3 p-3 rounded-lg border"
          >
            <Checkbox
              id={pkg.name}
              checked={selectedExtras.includes(pkg.name)}
              onCheckedChange={(checked) => {
                onToggleExtra(pkg.name, checked);
              }}
            />
            <div className="flex-1">
              <Label htmlFor={pkg.name} className="font-medium cursor-pointer">
                {pkg.name}
                {pkg.default_install && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {t("common.default")}
                  </Badge>
                )}
                <Badge variant="outline" className="ml-2 text-xs">
                  {pkg.recommended || pkg.min}
                </Badge>
              </Label>
              <p className="text-sm text-muted-foreground mt-0.5">
                {pkg.description}
              </p>
            </div>
          </div>
        ))}

        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={onBack}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            {t("common.back")}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onSkipInstall}>
              {t("setupWizard.extras.skipInstall")}
            </Button>
            <Button onClick={onInstall}>
              {t("setupWizard.extras.install")}
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface InstallProgressStepCardProps {
  installError: string | null;
  installMessage: string;
  installProgress: number;
  onSkipInstall: () => void | Promise<void>;
}

export function InstallProgressStepCard({
  installError,
  installMessage,
  installProgress,
  onSkipInstall,
}: InstallProgressStepCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("setupWizard.install.title")}
        </CardTitle>
        <CardDescription>{t("setupWizard.install.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={installProgress} className="h-2" />
        <p className="text-sm text-center text-muted-foreground">
          {installMessage}
        </p>

        {installError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{installError}</AlertDescription>
          </Alert>
        )}

        {installError && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" onClick={onSkipInstall}>
              {t("setupWizard.install.continueAnyway")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ReadyStepCardProps {
  effectiveExtras: string[];
  isPortableMode: boolean;
  onLaunch: () => void | Promise<void>;
  onReconfigure: () => void | Promise<void>;
  onSkipNextTimeChange: (checked: EnvSetupCheckedState) => void;
  selectedProfile: string;
  skipNextTime: boolean;
}

export function ReadyStepCard({
  effectiveExtras,
  isPortableMode,
  onLaunch,
  onReconfigure,
  onSkipNextTimeChange,
  selectedProfile,
  skipNextTime,
}: ReadyStepCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="flex items-center justify-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          {t("setupWizard.ready.title")}
        </CardTitle>
        <CardDescription>{t("setupWizard.ready.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("setupWizard.ready.profile")}</span>
            <span className="font-medium">{selectedProfile}</span>
          </div>
          {effectiveExtras.length > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("setupWizard.ready.extras")}</span>
              <span className="font-medium">{effectiveExtras.length} packages</span>
            </div>
          )}
        </div>

        {isPortableMode && (
          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="skip-wizard"
              checked={skipNextTime}
              onCheckedChange={onSkipNextTimeChange}
            />
            <Label htmlFor="skip-wizard" className="text-sm text-muted-foreground cursor-pointer">
              {t("setupWizard.ready.dontAskAgain")}
            </Label>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={onReconfigure}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("setupWizard.ready.reconfigure")}
          </Button>
          <Button size="lg" onClick={onLaunch}>
            {t("setupWizard.ready.launch")}
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
