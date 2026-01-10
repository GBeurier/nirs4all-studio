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

import { useState, useEffect } from "react";
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
import { selectFolder } from "@/utils/fileDialogs";
import { WorkspaceStats } from "@/components/settings/WorkspaceStats";
import { DataLoadingDefaultsForm } from "@/components/settings/DataLoadingDefaultsForm";
import { KeyboardShortcuts } from "@/components/settings/KeyboardShortcuts";
import { RecentWorkspacesList } from "@/components/settings/RecentWorkspacesList";
import { CreateWorkspaceDialog } from "@/components/settings/CreateWorkspaceDialog";
import { ExportImportDialog } from "@/components/settings/ExportImportDialog";

import { SystemInfo } from "@/components/settings/SystemInfo";
import { BackendStatus } from "@/components/settings/BackendStatus";
import { ErrorLogViewer } from "@/components/settings/ErrorLogViewer";
import { LanguageSelector } from "@/components/settings/LanguageSelector";
import { N4AWorkspaceSelector } from "@/components/settings/N4AWorkspaceSelector";
import { N4AWorkspaceList } from "@/components/settings/N4AWorkspaceList";
import { WorkspaceDiscoveryPanel } from "@/components/settings/WorkspaceDiscoveryPanel";
import { UpdatesSection } from "@/components/settings/UpdatesSection";
import { DependenciesManager } from "@/components/settings/DependenciesManager";
import {
  getWorkspace,
  selectWorkspace,
  getLinkedWorkspaces,
} from "@/api/client";
import type { UIDensity } from "@/types/settings";
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
  const { theme, setTheme } = useTheme();
  const { isDeveloperMode, setDeveloperMode, isLoading: isLoadingDevMode } = useDeveloperMode();
  const { density, setDensity, reduceAnimations, setReduceAnimations, isLoading: isLoadingUI } = useUISettings();
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

  const handleSelectWorkspace = async () => {
    const path = await selectFolder();
    if (path) {
      try {
        await selectWorkspace(path);
        setWorkspacePath(path);
        // Reload to get the name
        loadWorkspace();
      } catch (error) {
        console.error("Failed to set workspace:", error);
      }
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
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="general">{t("settings.tabs.general")}</TabsTrigger>
            <TabsTrigger value="workspace">{t("settings.tabs.workspace")}</TabsTrigger>
            <TabsTrigger value="n4a">N4A Workspaces</TabsTrigger>
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

          {/* Workspace Tab */}
          <TabsContent value="workspace" className="space-y-6">
            {/* Current Workspace */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5" />
                  {t("settings.workspace.current.title")}
                </CardTitle>
                <CardDescription>
                  {t("settings.workspace.current.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <Input
                    placeholder={t("settings.workspace.current.placeholder")}
                    value={workspacePath || ""}
                    readOnly
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={handleSelectWorkspace}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    {t("settings.workspace.current.browseButton")}
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant={workspacePath ? "default" : "outline"}>
                    {workspacePath ? t("common.active") : t("common.notConfigured")}
                  </Badge>
                  {workspaceName && (
                    <span className="font-medium">{workspaceName}</span>
                  )}
                </div>
                {/* Workspace action buttons */}
                <div className="flex gap-2 pt-2">
                  <CreateWorkspaceDialog
                    onWorkspaceCreated={() => loadWorkspace()}
                    trigger={
                      <Button variant="outline" size="sm">
                        <FolderPlus className="mr-2 h-4 w-4" />
                        {t("settings.workspace.create.createButton")}
                      </Button>
                    }
                  />
                  {workspacePath && (
                    <ExportImportDialog
                      onComplete={() => loadWorkspace()}
                      trigger={
                        <Button variant="outline" size="sm">
                          <FileArchive className="mr-2 h-4 w-4" />
                          {t("common.export")}/{t("common.import")}
                        </Button>
                      }
                    />
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Workspace Statistics */}
            {workspacePath ? (
              <WorkspaceStats />
            ) : (
              <Card className="border-dashed">
                <CardContent className="p-6 text-center text-muted-foreground">
                  <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{t("settings.workspace.current.selectButton")}</p>
                </CardContent>
              </Card>
            )}



            {/* Recent Workspaces */}
            <Collapsible defaultOpen>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ChevronRight className="h-4 w-4 transition-transform [[data-state=open]>&]:rotate-90" />
                      {t("settings.workspace.recent.title")}
                    </CardTitle>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <RecentWorkspacesList
                      currentWorkspacePath={workspacePath}
                      limit={5}
                      onWorkspaceSwitch={(path) => {
                        setWorkspacePath(path);
                        loadWorkspace();
                      }}
                    />
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </TabsContent>

          {/* N4A Workspaces Tab */}
          <TabsContent value="n4a" className="space-y-6">
            {/* Link New Workspace */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderPlus className="h-5 w-5" />
                  nirs4all Workspaces
                </CardTitle>
                <CardDescription>
                  Link nirs4all workspaces to discover runs, exports, and predictions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <N4AWorkspaceSelector onWorkspaceLinked={loadN4AWorkspaces} />
                </div>

                <Separator />

                {/* Linked Workspaces List */}
                <N4AWorkspaceList onWorkspaceChange={loadN4AWorkspaces} />
              </CardContent>
            </Card>

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
                  <strong>Note:</strong> Linking a workspace allows the app to discover and display
                  runs, predictions, and exported pipelines. Your files remain in their original location.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Data Defaults Tab */}
          <TabsContent value="data" className="space-y-6">
            {workspacePath ? (
              <DataLoadingDefaultsForm />
            ) : (
              <Card className="border-dashed">
                <CardContent className="p-6 text-center text-muted-foreground">
                  <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>{t("settings.dataDefaults.selectWorkspace")}</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={handleSelectWorkspace}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    {t("settings.workspace.current.selectButton")}
                  </Button>
                </CardContent>
              </Card>
            )}

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
