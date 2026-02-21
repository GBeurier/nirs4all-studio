/**
 * Config Alignment Panel for Settings > Advanced
 *
 * Shows comparison between installed packages and recommended config.
 * Provides "Align" action to install/upgrade packages to match.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  AlertTriangle,
  Download,
  RefreshCw,
  Loader2,
  Shield,
  Package,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useConfigDiff,
  useAlignConfig,
  useRecommendedConfig,
} from "@/hooks/useRecommendedConfig";
import type { PackageDiff } from "@/api/client";

interface ActionResult {
  type: "align";
  success: boolean;
  message: string;
}

export function ConfigAlignment() {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const [lastAction, setLastAction] = useState<ActionResult | null>(null);

  const { data: diff, isLoading: diffLoading, refetch: refetchDiff } = useConfigDiff(undefined, true);
  const { data: config } = useRecommendedConfig();
  const alignMutation = useAlignConfig();

  const handleAlign = async () => {
    if (!diff?.profile) return;

    setLastAction(null);
    alignMutation.mutate(
      { profile: diff.profile },
      {
        onSuccess: (result) => {
          setLastAction({
            type: "align",
            success: result.success,
            message: result.message,
          });
          refetchDiff();
        },
        onError: (err) => {
          setLastAction({
            type: "align",
            success: false,
            message: err instanceof Error ? err.message : t("setupWizard.install.failed"),
          });
        },
      },
    );
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "aligned":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "outdated":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "missing":
        return <Download className="h-4 w-4 text-red-500" />;
      default:
        return <Package className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "aligned":
        return <Badge variant="outline" className="text-green-600 border-green-200">{t("settings.configAlignment.aligned")}</Badge>;
      case "outdated":
        return <Badge variant="outline" className="text-yellow-600 border-yellow-200">{t("settings.configAlignment.outdated")}</Badge>;
      case "missing":
        return <Badge variant="destructive">{t("settings.configAlignment.missing")}</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              {t("settings.configAlignment.title")}
            </CardTitle>
            <CardDescription>
              {t("settings.configAlignment.description")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetchDiff()}
              disabled={diffLoading}
            >
              <RefreshCw className={`h-4 w-4 ${diffLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {diffLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
          </div>
        ) : diff ? (
          <>
            {/* Summary bar */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                {diff.is_aligned ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {diff.is_aligned
                      ? t("settings.configAlignment.allAligned")
                      : t("settings.configAlignment.driftDetected", {
                          count: diff.misaligned_count + diff.missing_count,
                        })}
                  </p>
                  {diff.profile_label && (
                    <p className="text-xs text-muted-foreground">
                      {t("settings.configAlignment.activeProfile", {
                        profile: diff.profile_label,
                      })}
                    </p>
                  )}
                </div>
              </div>
              {!diff.is_aligned && (
                <Button
                  size="sm"
                  onClick={handleAlign}
                  disabled={alignMutation.isPending}
                >
                  {alignMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  {t("settings.configAlignment.alignAll")}
                </Button>
              )}
            </div>

            {/* Action result notification */}
            {lastAction && (
              <Alert variant={lastAction.success ? "default" : "destructive"}>
                <AlertDescription>{lastAction.message}</AlertDescription>
              </Alert>
            )}

            {/* Package details */}
            <Collapsible open={showDetails} onOpenChange={setShowDetails}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-start">
                  {showDetails
                    ? t("settings.configAlignment.hideDetails")
                    : t("settings.configAlignment.showDetails")}
                  <Badge variant="secondary" className="ml-2">
                    {diff.packages.length}
                  </Badge>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 mt-2">
                {diff.packages.map((pkg: PackageDiff) => (
                  <div
                    key={pkg.name}
                    className="flex items-center justify-between p-2 rounded-md border text-sm"
                  >
                    <div className="flex items-center gap-2">
                      {statusIcon(pkg.status)}
                      <span className="font-medium">{pkg.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {pkg.installed_version && (
                        <span className="text-muted-foreground">
                          {pkg.installed_version}
                        </span>
                      )}
                      {pkg.installed_version &&
                        pkg.status !== "aligned" && (
                          <span className="text-muted-foreground">&rarr;</span>
                        )}
                      <span className={pkg.status === "aligned" ? "text-muted-foreground" : ""}>
                        {pkg.recommended_version}
                      </span>
                      {statusBadge(pkg.status)}
                    </div>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>

            {/* Config source info */}
            {config && (
              <p className="text-xs text-muted-foreground">
                {t("settings.configAlignment.source", {
                  source: config.fetched_from,
                  version: config.app_version,
                })}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("settings.configAlignment.unavailable")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
