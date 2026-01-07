/**
 * CreateWorkspaceDialog Component
 *
 * A dialog for creating a new workspace with options for:
 * - Workspace name
 * - Location (folder path)
 * - Optional description
 * - Create standard folder structure
 *
 * Phase 3 Implementation
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  FolderPlus,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { selectFolder } from "@/utils/fileDialogs";
import { createWorkspace, selectWorkspace } from "@/api/client";
import type { WorkspaceInfo } from "@/types/settings";

export interface CreateWorkspaceDialogProps {
  /** Callback when workspace is created successfully */
  onWorkspaceCreated?: (workspace: WorkspaceInfo) => void;
  /** Button trigger element (optional, provides default) */
  trigger?: React.ReactNode;
  /** Auto-switch to new workspace after creation */
  autoSwitch?: boolean;
}

export function CreateWorkspaceDialog({
  onWorkspaceCreated,
  trigger,
  autoSwitch = true,
}: CreateWorkspaceDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<WorkspaceInfo | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [createStructure, setCreateStructure] = useState(true);

  const resetForm = () => {
    setName("");
    setLocation("");
    setDescription("");
    setCreateStructure(true);
    setError(null);
    setSuccess(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      // Reset on close
      resetForm();
    }
  };

  const handleBrowse = async () => {
    const path = await selectFolder();
    if (path) {
      setLocation(path);
      // If name is empty, use the folder name
      if (!name) {
        const folderName = path.split(/[/\\]/).pop() || "";
        setName(folderName);
      }
    }
  };

  const handleCreate = async () => {
    // Validation
    if (!name.trim()) {
      setError(t("settings.workspace.create.validation.nameRequired"));
      return;
    }
    if (!location.trim()) {
      setError(t("settings.workspace.create.validation.locationRequired"));
      return;
    }

    try {
      setIsCreating(true);
      setError(null);

      // Build the full path (location/name)
      const fullPath = location.endsWith("/") || location.endsWith("\\")
        ? `${location}${name}`
        : `${location}/${name}`;

      const workspace = await createWorkspace({
        path: fullPath,
        name: name.trim(),
        description: description.trim() || undefined,
        create_dir: createStructure,
      });

      setSuccess(workspace);

      // Auto-switch to the new workspace
      if (autoSwitch) {
        await selectWorkspace(workspace.path);
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }

      onWorkspaceCreated?.(workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create workspace";
      // Extract detail from API error if available
      const apiError = err as { detail?: string };
      setError(apiError.detail || message);
    } finally {
      setIsCreating(false);
    }
  };

  const isValid = name.trim() && location.trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <FolderPlus className="mr-2 h-4 w-4" />
            {t("common.create")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5" />
            {t("settings.workspace.create.title")}
          </DialogTitle>
          <DialogDescription>
            {t("settings.workspace.create.description")}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">{t("settings.workspace.create.success")}</span>
            </div>
            <div className="bg-muted p-3 rounded-md space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">{t("settings.workspace.create.name")}: </span>
                <span className="font-medium">{success.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("settings.workspace.create.path")}: </span>
                <span className="font-mono text-xs">{success.path}</span>
              </div>
              {success.description && (
                <div>
                  <span className="text-muted-foreground">{t("settings.workspace.create.descriptionLabel")}: </span>
                  <span>{success.description}</span>
                </div>
              )}
            </div>
            {autoSwitch && (
              <p className="text-sm text-muted-foreground">
                {t("settings.workspace.create.switching")}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Name input */}
            <div className="space-y-2">
              <Label htmlFor="workspace-name">
                {t("settings.workspace.create.name")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="workspace-name"
                placeholder={t("settings.workspace.create.namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isCreating}
              />
            </div>

            {/* Location input */}
            <div className="space-y-2">
              <Label htmlFor="workspace-location">
                {t("settings.workspace.create.location")} <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="workspace-location"
                  placeholder={t("settings.workspace.create.locationPlaceholder")}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="flex-1"
                  disabled={isCreating}
                />
                <Button
                  variant="outline"
                  onClick={handleBrowse}
                  disabled={isCreating}
                >
                  <FolderOpen className="mr-2 h-4 w-4" />
                  {t("common.browse")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.workspace.create.pathPreview")}{": "}
                {location && name ? (
                  <span className="font-mono">
                    {location.endsWith("/") || location.endsWith("\\")
                      ? `${location}${name}`
                      : `${location}/${name}`}
                  </span>
                ) : (
                  <span className="italic">{t("settings.workspace.create.pathPreviewEmpty")}</span>
                )}
              </p>
            </div>

            {/* Description input */}
            <div className="space-y-2">
              <Label htmlFor="workspace-description">{t("settings.workspace.create.descriptionLabel")}</Label>
              <Textarea
                id="workspace-description"
                placeholder={t("settings.workspace.create.descriptionPlaceholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                disabled={isCreating}
              />
            </div>

            {/* Create structure checkbox */}
            <div className="flex items-start space-x-2">
              <Checkbox
                id="create-structure"
                checked={createStructure}
                onCheckedChange={(checked) => setCreateStructure(checked === true)}
                disabled={isCreating}
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor="create-structure"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {t("settings.workspace.create.createStructure")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.workspace.create.createStructureHint")}
                </p>
              </div>
            </div>

            {/* Error display */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive p-3 bg-destructive/10 rounded-md">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {success ? (
            <Button onClick={() => handleOpenChange(false)}>
              {t("common.close")}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isCreating}
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!isValid || isCreating}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("common.creating")}
                  </>
                ) : (
                  <>
                    <FolderPlus className="mr-2 h-4 w-4" />
                    {t("settings.workspace.create.createButton")}
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateWorkspaceDialog;
