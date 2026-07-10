/**
 * Settings page sections (render-only)
 *
 * Presentational building blocks extracted from `Settings.tsx` to keep that
 * route focused on state, effects, and side-effect callbacks. Every component
 * here is render-only: it receives the data and handlers it needs as props and
 * mounts the existing settings child components unchanged. Behavior, labels,
 * translations, and layout are identical to the original inline markup.
 */

import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  Monitor,
  Sun,
  Moon,
  Palette,
  RefreshCw,
  Code2,
  LayoutGrid,
  Sparkles,
  FolderPlus,
  FileArchive,
  ZoomIn,
  RotateCcw,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { WorkspaceStats } from "@/components/settings/WorkspaceStats";
import { DataLoadingDefaultsForm } from "@/components/settings/DataLoadingDefaultsForm";
import { KeyboardShortcuts } from "@/components/settings/KeyboardShortcuts";
import { CreateWorkspaceDialog } from "@/components/settings/CreateWorkspaceDialog";
import { SystemInfo } from "@/components/settings/SystemInfo";
import { BackendStatus } from "@/components/settings/BackendStatus";
import { ErrorLogViewer } from "@/components/settings/ErrorLogViewer";
import { LanguageSelector } from "@/components/settings/LanguageSelector";
import { RuntimeBackendPreference } from "@/components/settings/RuntimeBackendPreference";
import { N4AWorkspaceSelector } from "@/components/settings/N4AWorkspaceSelector";
import { N4AWorkspaceList } from "@/components/settings/N4AWorkspaceList";
import { WorkspaceDiscoveryPanel } from "@/components/settings/WorkspaceDiscoveryPanel";
import { UpdatesSection } from "@/components/settings/UpdatesSection";
import { DependenciesManager } from "@/components/settings/DependenciesManager";
import { ConfigPathSettings } from "@/components/settings/ConfigPathSettings";
import { ConfigAlignment } from "@/components/settings/ConfigAlignment";
import { PythonEnvPicker } from "@/components/settings/PythonEnvPicker";
import { StorageHealthWidget } from "@/components/settings/StorageHealthWidget";
import type { ThemeOption, UIDensity, UIZoomLevel } from "@/types/settings";
import type { TelemetryConsentStatus } from "@/lib/telemetryConsent";

export interface GeneralSettingsTabProps {
  theme: ThemeOption;
  setTheme: (theme: ThemeOption) => void;
  density: UIDensity;
  setDensity: (density: UIDensity) => void;
  zoomLevel: UIZoomLevel;
  setZoomLevel: (zoom: UIZoomLevel) => void;
  reduceAnimations: boolean;
  setReduceAnimations: (value: boolean) => void;
  isLoadingUI: boolean;
  telemetryConsent: TelemetryConsentStatus;
  handleTelemetryConsentChange: (enabled: boolean) => void;
  isSavingTelemetryConsent: boolean;
}

export function GeneralSettingsTab({
  theme,
  setTheme,
  density,
  setDensity,
  zoomLevel,
  setZoomLevel,
  reduceAnimations,
  setReduceAnimations,
  isLoadingUI,
  telemetryConsent,
  handleTelemetryConsentChange,
  isSavingTelemetryConsent,
}: GeneralSettingsTabProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Appearance Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            {t("settings.general.appearance.title")}
          </CardTitle>
          <CardDescription>
            {t("settings.general.appearance.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Theme Selection */}
          <div>
            <label className="text-sm font-medium mb-3 block">{t("settings.general.appearance.theme")}</label>
            <div className="flex gap-2">
              <Button
                variant={theme === "light" ? "default" : "outline"}
                onClick={() => setTheme("light")}
                className="flex-1"
              >
                <Sun className="mr-2 h-4 w-4" />
                {t("settings.general.appearance.themeLight")}
              </Button>
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                onClick={() => setTheme("dark")}
                className="flex-1"
              >
                <Moon className="mr-2 h-4 w-4" />
                {t("settings.general.appearance.themeDark")}
              </Button>
              <Button
                variant={theme === "system" ? "default" : "outline"}
                onClick={() => setTheme("system")}
                className="flex-1"
              >
                <Monitor className="mr-2 h-4 w-4" />
                {t("settings.general.appearance.themeSystem")}
              </Button>
            </div>
          </div>

          <Separator />

          {/* UI Density */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <LayoutGrid className="h-4 w-4 text-muted-foreground" />
              <label className="text-sm font-medium">{t("settings.general.density.title")}</label>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {t("settings.general.density.description")}
            </p>
            <ToggleGroup
              type="single"
              value={density}
              onValueChange={(value) => value && setDensity(value as UIDensity)}
              className="justify-start"
              disabled={isLoadingUI}
            >
              <ToggleGroupItem value="compact" aria-label={t("settings.general.density.compact")}>
                {t("settings.general.density.compact")}
              </ToggleGroupItem>
              <ToggleGroupItem value="comfortable" aria-label={t("settings.general.density.comfortable")}>
                {t("settings.general.density.comfortable")}
              </ToggleGroupItem>
              <ToggleGroupItem value="spacious" aria-label={t("settings.general.density.spacious")}>
                {t("settings.general.density.spacious")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <Separator />

          {/* UI Zoom Level */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ZoomIn className="h-4 w-4 text-muted-foreground" />
              <label className="text-sm font-medium">{t("settings.general.zoom.title")}</label>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {t("settings.general.zoom.description")}
            </p>
            <ToggleGroup
              type="single"
              value={String(zoomLevel)}
              onValueChange={(value) => value && setZoomLevel(parseInt(value, 10) as UIZoomLevel)}
              className="justify-start flex-wrap"
              disabled={isLoadingUI}
            >
              <ToggleGroupItem value="75" aria-label="75%">75%</ToggleGroupItem>
              <ToggleGroupItem value="80" aria-label="80%">80%</ToggleGroupItem>
              <ToggleGroupItem value="90" aria-label="90%">90%</ToggleGroupItem>
              <ToggleGroupItem value="100" aria-label="100%">100%</ToggleGroupItem>
              <ToggleGroupItem value="110" aria-label="110%">110%</ToggleGroupItem>
              <ToggleGroupItem value="125" aria-label="125%">125%</ToggleGroupItem>
              <ToggleGroupItem value="150" aria-label="150%">150%</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <Separator />

          {/* Reduce Animations */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">{t("settings.general.animations.title")}</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.general.animations.description")}
              </p>
            </div>
            <Switch
              checked={reduceAnimations}
              onCheckedChange={setReduceAnimations}
              disabled={isLoadingUI}
            />
          </div>

          <Separator />

          {/* Language Selection */}
          <LanguageSelector />
        </CardContent>
      </Card>

      {/* Privacy & Diagnostics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            {t("settings.general.telemetry.title")}
          </CardTitle>
          <CardDescription>
            {t("settings.general.telemetry.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label className="text-sm font-medium">
                {t("settings.general.telemetry.enable")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.general.telemetry.hint")}
              </p>
              <p className="text-xs text-muted-foreground">
                {telemetryConsent === "accepted"
                  ? t("settings.general.telemetry.statusEnabled")
                  : t("settings.general.telemetry.statusDisabled")}
              </p>
            </div>
            <Switch
              checked={telemetryConsent === "accepted"}
              onCheckedChange={handleTelemetryConsentChange}
              disabled={isSavingTelemetryConsent}
            />
          </div>
        </CardContent>
      </Card>

      {/* Keyboard Shortcuts */}
      <KeyboardShortcuts />
    </>
  );
}

export interface WorkspacesSettingsTabProps {
  workspacePath: string | null;
  activeN4AWorkspaceId: string | null;
  loadWorkspace: () => void;
  loadN4AWorkspaces: () => void;
}

export function WorkspacesSettingsTab({
  workspacePath,
  activeN4AWorkspaceId,
  loadWorkspace,
  loadN4AWorkspaces,
}: WorkspacesSettingsTabProps) {
  return (
    <>
      {/* Linked Workspaces Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Workspaces
          </CardTitle>
          <CardDescription>
            Manage nirs4all workspaces. The active workspace is where all runs and artifacts are saved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <N4AWorkspaceSelector onWorkspaceLinked={loadN4AWorkspaces} />
            <CreateWorkspaceDialog
              onWorkspaceCreated={() => {
                loadWorkspace();
                loadN4AWorkspaces();
              }}
              trigger={
                <Button variant="outline">
                  <FolderPlus className="mr-2 h-4 w-4" />
                  Create New
                </Button>
              }
            />
          </div>

          <Separator />

          {/* Linked Workspaces List */}
          <N4AWorkspaceList
            onWorkspaceChange={() => {
              loadN4AWorkspaces();
              loadWorkspace();
            }}
          />
        </CardContent>
      </Card>

      {/* Workspace Statistics — keyed by active workspace id so they
          remount (and refetch) whenever the user switches workspaces. */}
      {workspacePath && <WorkspaceStats key={`stats-${activeN4AWorkspaceId ?? "none"}`} />}
      {workspacePath && <StorageHealthWidget key={`storage-${activeN4AWorkspaceId ?? "none"}`} />}

      {/* Discovery Panel */}
      {activeN4AWorkspaceId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileArchive className="h-5 w-5" />
              Discovered Content
            </CardTitle>
            <CardDescription>
              Runs, exports, predictions, and templates from the active workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkspaceDiscoveryPanel workspaceId={activeN4AWorkspaceId} />
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            <strong>Note:</strong> The active workspace is where nirs4all saves all runs, predictions,
            and exported pipelines. You can link multiple workspaces and switch between them.
          </p>
        </CardContent>
      </Card>
    </>
  );
}

export function DataSettingsTab() {
  const { t } = useTranslation();

  return (
    <>
      <DataLoadingDefaultsForm />

      {/* Info about defaults */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            <strong>{t("common.info")}:</strong> {t("settings.dataDefaults.note")}
          </p>
        </CardContent>
      </Card>
    </>
  );
}

export interface AdvancedSettingsTabProps {
  isDeveloperMode: boolean;
  handleDeveloperModeChange: (enabled: boolean) => void;
  isLoadingDevMode: boolean;
  workspacePath: string | null;
  backendUrl: string;
  isRestarting: boolean;
  handleRestartBackend: () => void;
  handleClearLocalStorage: () => void;
  handleResetToDefaults: () => void;
}

export function AdvancedSettingsTab({
  isDeveloperMode,
  handleDeveloperModeChange,
  isLoadingDevMode,
  workspacePath,
  backendUrl,
  isRestarting,
  handleRestartBackend,
  handleClearLocalStorage,
  handleResetToDefaults,
}: AdvancedSettingsTabProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Python Environment Picker (Electron only) */}
      <PythonEnvPicker />

      {/* Developer Mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code2 className="h-5 w-5" />
            {t("settings.advanced.developer.title")}
          </CardTitle>
          <CardDescription>
            {t("settings.advanced.developer.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">
                {t("settings.advanced.developer.enable")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.advanced.developer.hint")}
              </p>
            </div>
            <Switch
              checked={isDeveloperMode}
              onCheckedChange={handleDeveloperModeChange}
              disabled={isLoadingDevMode || !workspacePath}
            />
          </div>
        </CardContent>
      </Card>

      {/* Backend Status - Always visible */}
      <BackendStatus checkInterval={30} />

      <RuntimeBackendPreference />

      {/* Config Path Settings */}
      <ConfigPathSettings />

      {/* Updates Section */}
      <UpdatesSection />

      {/* Config Alignment */}
      <ConfigAlignment />

      {/* Dependencies Manager */}
      <DependenciesManager />

      {/* Backend Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            {t("settings.advanced.backend.title")}
          </CardTitle>
          <CardDescription>
            {t("settings.advanced.backend.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{t("settings.advanced.backend.url")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settings.advanced.backend.urlHint")}
              </p>
            </div>
            <Input
              value={backendUrl}
              className="w-64"
              readOnly
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{t("settings.advanced.backend.restart")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settings.advanced.backend.restartHint")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={isRestarting}
              onClick={handleRestartBackend}
            >
              {isRestarting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-2 h-3 w-3" />}
              {isRestarting ? t("settings.advanced.backend.restarting") : t("settings.advanced.backend.restart")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* System Information - Developer Mode Only */}
      {isDeveloperMode && <SystemInfo />}

      {/* Error Log Viewer - Developer Mode Only */}
      {isDeveloperMode && <ErrorLogViewer limit={50} autoRefresh={false} />}

      {/* Cache & Reset */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            {t("settings.advanced.troubleshooting.title")}
          </CardTitle>
          <CardDescription>
            {t("settings.advanced.troubleshooting.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{t("settings.advanced.troubleshooting.clearCache")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settings.advanced.troubleshooting.clearCacheHint")}
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  {t("settings.advanced.troubleshooting.clearCache")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("settings.advanced.troubleshooting.clearCacheConfirm")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("settings.advanced.troubleshooting.clearCacheDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearLocalStorage}>
                    {t("settings.advanced.troubleshooting.clearCache")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{t("settings.advanced.troubleshooting.resetDefaults")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settings.advanced.troubleshooting.resetDefaultsHint")}
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive">
                  {t("common.reset")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("settings.advanced.troubleshooting.resetDefaultsConfirm")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("settings.advanced.troubleshooting.resetDefaultsDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleResetToDefaults}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {t("settings.advanced.troubleshooting.resetDefaults")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
