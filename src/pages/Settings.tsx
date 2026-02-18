/**
 * Settings Page
 *
 * Reorganized with sections:
 * - General: Theme, UI density, animations, language, and keyboard shortcuts
 * - Workspace: Current workspace stats and management
 * - Data Defaults: Default settings for dataset loading
 * - Advanced: Developer options and troubleshooting
 *
 * Phase 2 (Settings Roadmap): General Settings Enhancements
 * Phase 3 (Settings Roadmap): Workspace Management Enhancements
 * Phase 5 Implementation: System Information & Diagnostics
 * Phase 6 Implementation: Localization (i18n)
 */

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import {
  FolderOpen,
  Monitor,
  Sun,
  Moon,
  Palette,
  RefreshCw,
  ChevronRight,
  Code2,
  LayoutGrid,
  Sparkles,
  FolderPlus,
  FileArchive,
  ZoomIn,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useDeveloperMode } from "@/context/DeveloperModeContext";
import { useUISettings } from "@/context/UISettingsContext";
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
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { N4AWorkspaceSelector } from "@/components/settings/N4AWorkspaceSelector";
import { N4AWorkspaceList } from "@/components/settings/N4AWorkspaceList";
import { WorkspaceDiscoveryPanel } from "@/components/settings/WorkspaceDiscoveryPanel";
import { UpdatesSection } from "@/components/settings/UpdatesSection";
import { DependenciesManager } from "@/components/settings/DependenciesManager";
import { ConfigPathSettings } from "@/components/settings/ConfigPathSettings";
import { StorageHealthWidget } from "@/components/settings/StorageHealthWidget";
import {
  getWorkspace,
  getLinkedWorkspaces,
} from "@/api/client";
import type { UIDensity, UIZoomLevel } from "@/types/settings";
import type { LinkedWorkspace } from "@/types/linked-workspaces";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function Settings() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme, setTheme } = useTheme();
  const { isDeveloperMode, setDeveloperMode, isLoading: isLoadingDevMode } = useDeveloperMode();
  const { density, setDensity, reduceAnimations, setReduceAnimations, zoomLevel, setZoomLevel, isLoading: isLoadingUI } = useUISettings();
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true);
  const [activeN4AWorkspaceId, setActiveN4AWorkspaceId] = useState<string | null>(null);

  // Load workspace info on mount
  useEffect(() => {
    loadWorkspace();
    loadN4AWorkspaces();
  }, []);

  const loadN4AWorkspaces = async () => {
    try {
      const response = await getLinkedWorkspaces();
      setActiveN4AWorkspaceId(response.active_workspace_id);
    } catch (error) {
      console.error("Failed to load N4A workspaces:", error);
    }
  };

  const loadWorkspace = async () => {
    try {
      setIsLoadingWorkspace(true);
      const response = await getWorkspace();
      if (response.workspace) {
        setWorkspacePath(response.workspace.path);
        setWorkspaceName(response.workspace.name);
      }
    } catch (error) {
      console.error("Failed to load workspace:", error);
    } finally {
      setIsLoadingWorkspace(false);
    }
  };

  const handleDeveloperModeChange = async (enabled: boolean) => {
    try {
      await setDeveloperMode(enabled);
    } catch (error) {
      console.error("Failed to update developer mode:", error);
    }
  };

  const handleClearLocalStorage = () => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
  };

  const handleResetToDefaults = () => {
    localStorage.clear();
    sessionStorage.clear();
    setTheme("system");
    window.location.reload();
  };

  const initialTab = useMemo(() => {
    const tab = searchParams.get("tab");
    return tab === "workspaces" || tab === "data" || tab === "advanced" || tab === "general"
      ? tab
      : "general";
  }, [searchParams]);

  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", value);
      return next;
    });
  };

  return (
    <motion.div
      className="space-y-6 max-w-4xl"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="text-muted-foreground">
          {t("settings.subtitle")}
        </p>
      </motion.div>

      {/* Tabs for organization */}
      <motion.div variants={itemVariants}>
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">{t("settings.tabs.general")}</TabsTrigger>
            <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
            <TabsTrigger value="data">{t("settings.tabs.data")}</TabsTrigger>
            <TabsTrigger value="advanced">{t("settings.tabs.advanced")}</TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-6">
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

            {/* Keyboard Shortcuts */}
            <KeyboardShortcuts />
          </TabsContent>

          {/* Workspaces Tab (Merged) */}
          <TabsContent value="workspaces" className="space-y-6">
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
                <N4AWorkspaceList onWorkspaceChange={loadN4AWorkspaces} />
              </CardContent>
            </Card>

            {/* Workspace Statistics */}
            {workspacePath && <WorkspaceStats />}
            {workspacePath && <StorageHealthWidget />}

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
          </TabsContent>

          {/* Data Defaults Tab */}
          <TabsContent value="data" className="space-y-6">
            <DataLoadingDefaultsForm />

            {/* Info about defaults */}
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">
                  <strong>{t("common.info")}:</strong> {t("settings.dataDefaults.note")}
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Advanced Tab */}
          <TabsContent value="advanced" className="space-y-6">
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

            {/* Config Path Settings */}
            <ConfigPathSettings />

            {/* Updates Section */}
            <UpdatesSection />

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
                    defaultValue="http://127.0.0.1:8000"
                    className="w-64"
                    disabled
                  />
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
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* App Info */}
      <motion.div variants={itemVariants}>
        <Card className="border-dashed">
          <CardContent className="p-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("settings.appInfo.version", { version: "1.0.0" })}</span>
            <span>{t("settings.appInfo.copyright", { year: "2025-2026" })}</span>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
