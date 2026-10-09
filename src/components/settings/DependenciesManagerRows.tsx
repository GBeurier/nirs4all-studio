/**
 * Presentation components for the Dependencies Manager: the per-package row and
 * the collapsible category section. These are intentionally dumb: all version
 * branching lives in `dependencyVersionState` / `DependenciesManagerLogic`, and
 * all side effects come in as callbacks from `DependenciesManager`.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  Trash2,
  CheckCircle2,
  XCircle,
  ArrowUpCircle,
  ChevronDown,
  Loader2,
  Check,
  ArrowDownCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getDependencyVersionState } from "./dependencyVersionState";
import {
  getAboveBadgeLabel,
  getCategoryBadgeVariant,
  getCategoryProgressPercentage,
  getPackageRowClassName,
  getPackageStatusKind,
  getVersionBadgeKind,
} from "./DependenciesManagerLogic";
import type { DependencyCategory, DependencyInfo } from "@/api/dependencies";

function PackageStatusIcon({ pkg }: { pkg: DependencyInfo }) {
  switch (getPackageStatusKind(pkg)) {
    case "not-installed":
      return <XCircle className="h-5 w-5 text-muted-foreground" />;
    case "below":
      return <ArrowUpCircle className="h-5 w-5 text-amber-500" />;
    case "above":
      return <ArrowUpCircle className="h-5 w-5 text-blue-500" />;
    default:
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  }
}

function PackageVersionBadge({
  pkg,
  isAtRecommended,
  isAtLatest,
}: {
  pkg: DependencyInfo;
  isAtRecommended: boolean;
  isAtLatest: boolean;
}) {
  const { t } = useTranslation();
  switch (getVersionBadgeKind(pkg, isAtRecommended)) {
    case "not-installed":
      return (
        <Badge variant="outline" className="text-xs text-muted-foreground">
          {t("settings.dependencies.notInstalled")}
        </Badge>
      );
    case "recommended":
      return (
        <Badge className="text-xs font-mono bg-green-600 hover:bg-green-600 text-white gap-1">
          <Check className="h-3 w-3" />
          {t("settings.dependencies.recommendedBadge", { version: pkg.installed_version })}
        </Badge>
      );
    case "below":
      return (
        <Badge className="text-xs font-mono bg-amber-500 hover:bg-amber-500 text-white">
          v{pkg.installed_version}
        </Badge>
      );
    case "above":
      return (
        <Badge className="text-xs font-mono bg-blue-500 hover:bg-blue-500 text-white">
          {t("settings.dependencies.aboveBadge", { version: pkg.installed_version, label: t(`settings.dependencies.aboveLabel.${getAboveBadgeLabel(isAtLatest)}`) })}
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-xs font-mono">
          v{pkg.installed_version}
        </Badge>
      );
  }
}

export interface PackageRowProps {
  pkg: DependencyInfo;
  onInstall: (pkg: string) => Promise<void>;
  onUninstall: (pkg: string) => Promise<void>;
  onUpdateToLatest: (pkg: string) => Promise<void>;
  onRevertToRecommended: (pkg: string) => Promise<void>;
  isProcessing: string | null;
}

export function PackageRow({
  pkg,
  onInstall,
  onUninstall,
  onUpdateToLatest,
  onRevertToRecommended,
  isProcessing,
}: PackageRowProps) {
  const { t } = useTranslation();
  const isCurrentlyProcessing = isProcessing === pkg.name;

  const {
    isAtRecommended,
    isAtLatest,
    showRecommendedVersion,
    showLatestVersion,
    showUpdateToRecommended,
    showRevertToRecommended,
    showUpdateToLatest,
    shouldConfirmLatestUpdate,
  } = getDependencyVersionState(pkg);
  const supportsLatestTrack = pkg.managed_by_profile !== true;

  return (
    <div className={getPackageRowClassName(pkg)}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Status Icon */}
        <div className="flex-shrink-0">
          <PackageStatusIcon pkg={pkg} />
        </div>

        {/* Package Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{pkg.name}</span>
            <PackageVersionBadge
              pkg={pkg}
              isAtRecommended={isAtRecommended}
              isAtLatest={isAtLatest}
            />
            {pkg.default_install && (
              <Badge variant="secondary" className="text-xs">
                {t("common.default")}
              </Badge>
            )}
            {pkg.managed_by_profile && (
              <Badge variant="outline" className="text-xs">
                {t("settings.dependencies.profileManaged")}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {pkg.description}
          </p>
          {pkg.managed_by_profile && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.dependencies.profileManagedHint")}
            </p>
          )}
          {/* Version details line */}
          <div className="flex items-center gap-3 mt-0.5">
            {showRecommendedVersion && pkg.recommended_version && (
                <span className="text-xs text-muted-foreground">
                  {t("settings.dependencies.recommendedVersion", { version: pkg.recommended_version })}
                </span>
              )}
            {showLatestVersion && pkg.latest_version && (
                <span className="text-xs text-muted-foreground">
                  {t("settings.dependencies.latestVersion", { version: pkg.latest_version })}
                </span>
              )}
            {!pkg.is_installed && !pkg.recommended_version && (
              <span className="text-xs text-muted-foreground">
                {t("settings.dependencies.minVersion", { version: pkg.min_version })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0 ml-4">
        {isCurrentlyProcessing ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t("settings.dependencies.processing")}</span>
          </div>
        ) : (
          <>
            {pkg.is_installed ? (
              <>
                {/* Below recommended: Update to Recommended */}
                {showUpdateToRecommended && pkg.recommended_version && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRevertToRecommended(pkg.name)}
                    disabled={!!isProcessing}
                    className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/50"
                  >
                    <ArrowUpCircle className="h-4 w-4 mr-1" />
                    {t("settings.dependencies.updateToRecommended")}
                  </Button>
                )}

                {/* Above recommended: Revert to Recommended */}
                {showRevertToRecommended && pkg.recommended_version && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRevertToRecommended(pkg.name)}
                    disabled={!!isProcessing}
                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/50"
                  >
                    <ArrowDownCircle className="h-4 w-4 mr-1" />
                    {t("settings.dependencies.revertToRecommended")}
                  </Button>
                )}

                {/* Update to Latest (when latest > installed and latest != recommended) */}
                {supportsLatestTrack && showUpdateToLatest && shouldConfirmLatestUpdate && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!isProcessing}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ArrowUpCircle className="h-4 w-4 mr-1" />
                        {t("settings.dependencies.updateToLatest")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t("settings.dependencies.updateLatestTitle", { name: pkg.name })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("settings.dependencies.updateLatestDescription", {
                            latest: pkg.latest_version,
                            recommended: pkg.recommended_version,
                          })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => onUpdateToLatest(pkg.name)}
                        >
                          {t("settings.dependencies.updateTo", { version: pkg.latest_version })}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {/* Update to Latest (simple case: no recommended or latest == recommended) */}
                {supportsLatestTrack && showUpdateToLatest &&
                  !shouldConfirmLatestUpdate && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onUpdateToLatest(pkg.name)}
                      disabled={!!isProcessing}
                      className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/50"
                    >
                      <ArrowUpCircle className="h-4 w-4 mr-1" />
                      {t("settings.dependencies.updateToLatest")}
                    </Button>
                  )}

                {/* Uninstall */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!isProcessing}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      aria-label={t("settings.dependencies.uninstallAria", { name: pkg.name })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("settings.dependencies.uninstallTitle", { name: pkg.name })}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("settings.dependencies.uninstallDescription", { name: pkg.name })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => onUninstall(pkg.name)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {t("settings.dependencies.uninstall")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onInstall(pkg.name)}
                disabled={!!isProcessing}
                className="text-primary hover:bg-primary/10"
              >
                <Download className="h-4 w-4 mr-1" />
                {t("settings.dependencies.install")}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export interface CategorySectionProps {
  category: DependencyCategory;
  onInstall: (pkg: string) => Promise<void>;
  onUninstall: (pkg: string) => Promise<void>;
  onUpdateToLatest: (pkg: string) => Promise<void>;
  onRevertToRecommended: (pkg: string) => Promise<void>;
  isProcessing: string | null;
  defaultOpen?: boolean;
}

export function CategorySection({
  category,
  onInstall,
  onUninstall,
  onUpdateToLatest,
  onRevertToRecommended,
  isProcessing,
  defaultOpen = false,
}: CategorySectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const progressPercentage = getCategoryProgressPercentage(category);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted/70 transition-colors">
          <div className="flex items-center gap-3">
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                isOpen ? "rotate-180" : ""
              }`}
            />
            <div>
              <h4 className="font-medium text-sm">{category.name}</h4>
              <p className="text-xs text-muted-foreground">
                {category.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-24">
              <Progress value={progressPercentage} className="h-2" />
            </div>
            <Badge variant={getCategoryBadgeVariant(category)}>
              {category.installed_count}/{category.total_count}
            </Badge>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {category.packages.map((pkg) => (
          <PackageRow
            key={pkg.name}
            pkg={pkg}
            onInstall={onInstall}
            onUninstall={onUninstall}
            onUpdateToLatest={onUpdateToLatest}
            onRevertToRecommended={onRevertToRecommended}
            isProcessing={isProcessing}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
