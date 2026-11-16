/**
 * Updates Section — presentation shell
 *
 * Pure presentation/composition for the Updates settings card:
 * loading/error cards, the header, the alert banner, the application update
 * row and the settings collapsible.
 *
 * All hooks, mutations, dialog state, and API side effects stay in
 * `UpdatesSection.tsx` — this file only renders props and forwards callbacks.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ChevronDown,
  Download,
  ExternalLink,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import type { LastApplyResult, UpdateSettings } from "@/api/updates";

import { WebappUpdateRow } from "./UpdatesSectionRows";
import type { WebappUpdateRowState } from "./UpdatesSectionLogic";
import { getActiveLocale } from "@/lib/activeLocale";

export function UpdatesLoadingCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" />
          {t("settings.updates.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-8 w-32" />
      </CardContent>
    </Card>
  );
}

interface UpdatesErrorCardProps {
  onRetry: () => void;
  isRetrying: boolean;
}

export function UpdatesErrorCard({ onRetry, isRetrying }: UpdatesErrorCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Download className="h-5 w-5" />
          {t("settings.updates.title")}
        </CardTitle>
        <CardDescription className="text-destructive">
          {t("settings.updates.checkFailed")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={isRetrying}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
          {t("common.retry")}
        </Button>
      </CardContent>
    </Card>
  );
}

interface UpdatesSectionShellProps {
  // Header
  isChecking: boolean;
  onCheckNow: () => void;

  // Alert banner
  lastApplyResult: LastApplyResult | undefined;
  installerUrl: string | null;
  onOpenInstaller: () => void;
  onDismissApplyResult: () => void;
  isDismissApplyResultPending: boolean;

  // Update row
  webappRow: WebappUpdateRowState;
  onOpenWebappDialog: () => void;

  // Last check
  lastCheck: string | null | undefined;

  // Settings
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  settings: UpdateSettings | undefined;
  onAutoCheckToggle: (checked: boolean) => void;
  onPrereleaseToggle: (checked: boolean) => void;
  onOfflineModeChange: (value: "auto" | "on" | "off") => void;
  isSettingsPending: boolean;

  // Dialogs (rendered inside the card; own their state in UpdatesSection)
  children: ReactNode;
}

export function UpdatesSectionShell({
  isChecking,
  onCheckNow,
  lastApplyResult,
  installerUrl,
  onOpenInstaller,
  onDismissApplyResult,
  isDismissApplyResultPending,
  webappRow,
  onOpenWebappDialog,
  lastCheck,
  settingsOpen,
  onSettingsOpenChange,
  settings,
  onAutoCheckToggle,
  onPrereleaseToggle,
  onOfflineModeChange,
  isSettingsPending,
  children,
}: UpdatesSectionShellProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              {t("settings.updates.title")}
              {webappRow.hasUpdate && (
                <Badge variant="default" className="ml-2">
                  {t("settings.updates.availableCount", { count: 1 })}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {t("settings.updates.description")}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onCheckNow}
            disabled={isChecking}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isChecking ? "animate-spin" : ""}`} />
            {t("settings.updates.checkNow")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Previous update silently failed — surface it and offer the installer */}
        {lastApplyResult?.status === "failed" && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <div>
                {lastApplyResult.to_version
                  ? t("settings.updates.lastApplyFailedExpected", { from: lastApplyResult.from_version, to: lastApplyResult.to_version })
                  : t("settings.updates.lastApplyFailed", { from: lastApplyResult.from_version })}
              </div>
              <div className="flex gap-2">
                {installerUrl && (
                  <Button size="sm" variant="outline" onClick={onOpenInstaller}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {t("settings.updates.getInstaller")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onDismissApplyResult}
                  disabled={isDismissApplyResultPending}
                >
                  {t("settings.updates.dismiss")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Webapp Update */}
        <WebappUpdateRow
          row={webappRow}
          onOpenDialog={onOpenWebappDialog}
          onOpenInstaller={onOpenInstaller}
        />

        <p className="text-sm text-muted-foreground">
          {t("settings.updates.pythonHint")}{" "}
          <Link to="/settings?tab=python" className="font-medium text-primary underline-offset-4 hover:underline">
            {t("settings.updates.openPython")}
          </Link>
        </p>

        {/* Last Check Info */}
        {lastCheck && (
          <p className="text-xs text-muted-foreground">
            {t("settings.updates.lastChecked", { date: new Date(lastCheck).toLocaleString(getActiveLocale()) })}
          </p>
        )}

        <UpdateSettingsSection
          open={settingsOpen}
          onOpenChange={onSettingsOpenChange}
          settings={settings}
          onAutoCheckToggle={onAutoCheckToggle}
          onPrereleaseToggle={onPrereleaseToggle}
          onOfflineModeChange={onOfflineModeChange}
          isSettingsPending={isSettingsPending}
        />
      </CardContent>

      {children}
    </Card>
  );
}

interface UpdateSettingsSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: UpdateSettings | undefined;
  onAutoCheckToggle: (checked: boolean) => void;
  onPrereleaseToggle: (checked: boolean) => void;
  onOfflineModeChange: (value: "auto" | "on" | "off") => void;
  isSettingsPending: boolean;
}

function UpdateSettingsSection({
  open,
  onOpenChange,
  settings,
  onAutoCheckToggle,
  onPrereleaseToggle,
  onOfflineModeChange,
  isSettingsPending,
}: UpdateSettingsSectionProps) {
  const { t } = useTranslation();
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-2 h-auto">
          <span className="text-sm font-medium flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            {t("settings.updates.updateSettings")}
          </span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="auto-check">{t("settings.updates.autoCheck")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.updates.autoCheckHint")}
            </p>
          </div>
          <Switch
            id="auto-check"
            checked={settings?.auto_check ?? true}
            onCheckedChange={onAutoCheckToggle}
            disabled={isSettingsPending}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="prerelease">{t("settings.updates.prerelease")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.updates.prereleaseHint")}
            </p>
          </div>
          <Switch
            id="prerelease"
            checked={settings?.prerelease_channel ?? false}
            onCheckedChange={onPrereleaseToggle}
            disabled={isSettingsPending}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="offline-mode">{t("settings.updates.networkMode")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.updates.networkModeHint")}
            </p>
          </div>
          <select
            id="offline-mode"
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            value={settings?.offline_mode ?? "auto"}
            onChange={(e) => onOfflineModeChange(e.target.value as "auto" | "on" | "off")}
            disabled={isSettingsPending}
          >
            <option value="auto">{t("settings.updates.networkAuto")}</option>
            <option value="off">{t("settings.updates.networkOnline")}</option>
            <option value="on">{t("settings.updates.networkOffline")}</option>
          </select>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
