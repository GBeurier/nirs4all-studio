import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
} from "lucide-react";
import type {
  ConfigComparisonResponse,
  OptionalPackageInfo,
  PackageFailure,
  ProfileInfo,
} from "@/api/config";
import type { DependenciesResponse } from "@/api/dependencies";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PythonRuntimeDisplayState } from "@/lib/pythonRuntimeDisplay";
import type { PostSwitchValidation } from "@/types/pythonRuntime";
import {
  buildDependencyIndex,
  getOptionalTargetVersion,
  getPackageStatusBadge,
  normalizePackageName,
  shortVersion,
} from "./PythonEnvPickerLogic";
import {
  BusyProgressPanel,
  LoadingPanel,
  type BusyProgressState,
} from "./PythonEnvPickerPanels";

export interface PythonRuntimeReviewLabels {
  default: string;
  loading: string;
}

interface PythonRuntimeReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: PythonRuntimeReviewLabels;
  postSwitchValidation: PostSwitchValidation | null;
  runningPythonPath: string | null;
  runtimeDisplay: PythonRuntimeDisplayState;
  compatibleProfiles: ProfileInfo[];
  selectedReviewProfile: string;
  isAligning: boolean;
  alignStatus: Pick<BusyProgressState, "title" | "detail">;
  alignProgress: number;
  isReviewPreviewLoading: boolean;
  hasAlignmentPreview: boolean;
  alignmentChangesCount: number;
  reviewError: string | null;
  alignFailures: PackageFailure[];
  isReviewDetailsLoading: boolean;
  reviewProfileDiff: ConfigComparisonResponse | null;
  reviewDependencies: DependenciesResponse | null;
  reviewOptionalPackages: OptionalPackageInfo[];
  onUpdateReviewProfile: (profileId: string) => void;
  onToggleReviewExtra: (packageName: string) => void;
  onAlignRuntime: () => void | Promise<void>;
}

export function PythonRuntimeReviewDialog({
  open,
  onOpenChange,
  labels,
  postSwitchValidation,
  runningPythonPath,
  runtimeDisplay,
  compatibleProfiles,
  selectedReviewProfile,
  isAligning,
  alignStatus,
  alignProgress,
  isReviewPreviewLoading,
  hasAlignmentPreview,
  alignmentChangesCount,
  reviewError,
  alignFailures,
  isReviewDetailsLoading,
  reviewProfileDiff,
  reviewDependencies,
  reviewOptionalPackages,
  onUpdateReviewProfile,
  onToggleReviewExtra,
  onAlignRuntime,
}: PythonRuntimeReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Review Runtime After Switch</DialogTitle>
          <DialogDescription>
            The backend is now running under the selected interpreter. Review the profile and package targets for this machine, then align the runtime if needed.
          </DialogDescription>
        </DialogHeader>

        {postSwitchValidation ? (
          <div className="space-y-4 mt-2">
            <ReviewRuntimeSummary
              postSwitchValidation={postSwitchValidation}
              runningPythonPath={runningPythonPath}
              runtimeDisplay={runtimeDisplay}
            />

            {isAligning && (
              <BusyProgressPanel
                title={alignStatus.title}
                detail={alignStatus.detail}
                progress={alignProgress}
              />
            )}

            <AlignmentPreviewNotice
              isReviewPreviewLoading={isReviewPreviewLoading}
              alignmentChangesCount={alignmentChangesCount}
              hasAlignmentPreview={hasAlignmentPreview}
              message={postSwitchValidation.alignmentPreview?.message}
            />

            {reviewError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{reviewError}</AlertDescription>
              </Alert>
            )}

            <AlignFailuresList failures={alignFailures} />

            <CompatibleProfilesList
              compatibleProfiles={compatibleProfiles}
              selectedReviewProfile={selectedReviewProfile}
              recommendedProfileId={postSwitchValidation.gpuInfo?.recommended_profiles[0]}
              onUpdateReviewProfile={onUpdateReviewProfile}
            />

            <ProfilePackageTargets
              isReviewDetailsLoading={isReviewDetailsLoading}
              reviewProfileDiff={reviewProfileDiff}
            />

            <OptionalFeaturePackages
              labels={labels}
              isReviewDetailsLoading={isReviewDetailsLoading}
              reviewDependencies={reviewDependencies}
              reviewOptionalPackages={reviewOptionalPackages}
              selectedExtras={postSwitchValidation.selectedExtras}
              onToggleReviewExtra={onToggleReviewExtra}
            />
          </div>
        ) : (
          <LoadingPanel label={labels.loading} iconClassName="h-4 w-4" />
        )}

        <DialogFooter>
          <Button
            onClick={() => {
              void onAlignRuntime();
            }}
            disabled={
              isAligning
              || !postSwitchValidation?.runtimeSummary?.core_ready
              || !selectedReviewProfile
              || !hasAlignmentPreview
              || alignmentChangesCount === 0
            }
          >
            {isAligning ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : hasAlignmentPreview && alignmentChangesCount === 0 ? (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {isAligning ? "Aligning runtime..." : hasAlignmentPreview && alignmentChangesCount === 0 ? "Runtime aligned" : "Align runtime"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReviewRuntimeSummaryProps {
  postSwitchValidation: PostSwitchValidation;
  runningPythonPath: string | null;
  runtimeDisplay: PythonRuntimeDisplayState;
}

function ReviewRuntimeSummary({
  postSwitchValidation,
  runningPythonPath,
  runtimeDisplay,
}: ReviewRuntimeSummaryProps) {
  const missingOptionalCount = postSwitchValidation.runtimeSummary?.missing_optional_packages.length ?? 0;

  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm">
          Python {shortVersion(postSwitchValidation.runtimeSummary?.runtime.version ?? null)}
        </span>
        <Badge variant={postSwitchValidation.runtimeSummary?.core_ready ? "default" : "destructive"} className="text-xs">
          {postSwitchValidation.runtimeSummary?.core_ready ? "Core ready" : "Core missing"}
        </Badge>
        <Badge variant="secondary" className="text-xs">
          {postSwitchValidation.runtimeSummary?.runtime_kind ?? runtimeDisplay.runtimeKind}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground font-mono break-all">
        {postSwitchValidation.runtimeSummary?.running_python ?? runningPythonPath}
      </p>
      <p className="text-xs text-muted-foreground">
        {missingOptionalCount > 0
          ? `${missingOptionalCount} optional package gap${missingOptionalCount === 1 ? "" : "s"} detected.`
          : "No optional package gaps detected."}
      </p>
    </div>
  );
}

interface AlignmentPreviewNoticeProps {
  isReviewPreviewLoading: boolean;
  alignmentChangesCount: number;
  hasAlignmentPreview: boolean;
  message?: string;
}

function AlignmentPreviewNotice({
  isReviewPreviewLoading,
  alignmentChangesCount,
  hasAlignmentPreview,
  message,
}: AlignmentPreviewNoticeProps) {
  if (isReviewPreviewLoading) {
    return (
      <Alert>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertDescription>
          Preparing the alignment plan for the selected profile and optional packages.
        </AlertDescription>
      </Alert>
    );
  }

  if (alignmentChangesCount > 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {message}
        </AlertDescription>
      </Alert>
    );
  }

  if (hasAlignmentPreview) {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertDescription>
          The selected runtime already matches the suggested profile and selected optional packages.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        The alignment plan could not be loaded for this runtime yet.
      </AlertDescription>
    </Alert>
  );
}

interface AlignFailuresListProps {
  failures: PackageFailure[];
}

function AlignFailuresList({ failures }: AlignFailuresListProps) {
  if (failures.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Install errors</p>
      {failures.map((failure) => (
        <details
          key={failure.package}
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3"
        >
          <summary className="cursor-pointer text-sm font-medium">
            {failure.package}
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-background/50 p-2 text-[11px] font-mono text-muted-foreground">
            {failure.error}
          </pre>
        </details>
      ))}
    </div>
  );
}

interface CompatibleProfilesListProps {
  compatibleProfiles: ProfileInfo[];
  selectedReviewProfile: string;
  recommendedProfileId?: string;
  onUpdateReviewProfile: (profileId: string) => void;
}

function CompatibleProfilesList({
  compatibleProfiles,
  selectedReviewProfile,
  recommendedProfileId,
  onUpdateReviewProfile,
}: CompatibleProfilesListProps) {
  if (compatibleProfiles.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Compute profile</label>
      <div className="space-y-2">
        {compatibleProfiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            onClick={() => onUpdateReviewProfile(profile.id)}
            className={`w-full rounded-lg border p-3 text-left transition-colors ${
              selectedReviewProfile === profile.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{profile.label}</span>
              {recommendedProfileId === profile.id && (
                <Badge variant="default" className="text-xs">Recommended</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{profile.description}</p>
            <div className="mt-2 flex gap-1 flex-wrap">
              {Object.entries(profile.packages).map(([packageName, packageSpec]) => (
                <Badge key={packageName} variant="outline" className="text-xs">
                  {packageName} {packageSpec.recommended ?? packageSpec.min}
                </Badge>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

interface ProfilePackageTargetsProps {
  isReviewDetailsLoading: boolean;
  reviewProfileDiff: ConfigComparisonResponse | null;
}

function ProfilePackageTargets({
  isReviewDetailsLoading,
  reviewProfileDiff,
}: ProfilePackageTargetsProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Target packages for the selected profile</label>
      {isReviewDetailsLoading ? (
        <LoadingPanel label="Loading current and target versions…" iconClassName="h-4 w-4" />
      ) : reviewProfileDiff?.packages.length ? (
        <div className="space-y-2">
          {reviewProfileDiff.packages.map((pkg) => {
            const badge = getPackageStatusBadge(pkg.status);
            return (
              <div key={pkg.name} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{pkg.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Current: {pkg.installed_version ?? "Not present"}
                    </p>
                  </div>
                  <Badge variant={badge.variant} className="text-xs">
                    {badge.label}
                  </Badge>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>
                    <p className="uppercase tracking-wide">Current version</p>
                    <p className="mt-1 font-mono text-foreground">
                      {pkg.installed_version ?? "Not present"}
                    </p>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide">Target version</p>
                    <p className="mt-1 font-mono text-foreground">{pkg.recommended_version}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Package details are not available for this runtime yet.
        </div>
      )}
    </div>
  );
}

interface OptionalFeaturePackagesProps {
  labels: PythonRuntimeReviewLabels;
  isReviewDetailsLoading: boolean;
  reviewDependencies: DependenciesResponse | null;
  reviewOptionalPackages: OptionalPackageInfo[];
  selectedExtras: string[];
  onToggleReviewExtra: (packageName: string) => void;
}

function OptionalFeaturePackages({
  labels,
  isReviewDetailsLoading,
  reviewDependencies,
  reviewOptionalPackages,
  selectedExtras,
  onToggleReviewExtra,
}: OptionalFeaturePackagesProps) {
  const reviewDependencyIndex = buildDependencyIndex(reviewDependencies);

  if (reviewOptionalPackages.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Optional feature packages</label>
      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
        {reviewOptionalPackages.map((pkg) => {
          const dependency = reviewDependencyIndex.get(normalizePackageName(pkg.name));
          const isSelected = selectedExtras.includes(pkg.name);
          const currentVersion = isReviewDetailsLoading
            ? "Loading..."
            : dependency?.installed_version ?? "Not present";
          const isInstalled = !isReviewDetailsLoading && Boolean(dependency?.installed_version);

          return (
            <button
              key={pkg.name}
              type="button"
              onClick={() => onToggleReviewExtra(pkg.name)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{pkg.name}</p>
                    {pkg.default_install && (
                      <Badge variant="secondary" className="text-xs">
                        {labels.default}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{pkg.description}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge variant={isSelected ? "default" : "outline"} className="text-xs">
                    {isSelected ? "Selected" : "Skip"}
                  </Badge>
                  <Badge variant={isReviewDetailsLoading ? "secondary" : isInstalled ? "outline" : "secondary"} className="text-xs">
                    {isReviewDetailsLoading ? "Checking" : isInstalled ? "Present" : "Not present"}
                  </Badge>
                </div>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  <p className="uppercase tracking-wide">Current version</p>
                  <p className="mt-1 font-mono text-foreground">{currentVersion}</p>
                </div>
                <div>
                  <p className="uppercase tracking-wide">Target version</p>
                  <p className="mt-1 font-mono text-foreground">
                    {getOptionalTargetVersion(pkg)}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
