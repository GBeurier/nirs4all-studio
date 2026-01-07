/**
 * BackupSettings Component
 *
 * Form for configuring scheduled backup settings including:
 * - Enable/disable automatic backups
 * - Backup interval
 * - Maximum number of backups to retain
 * - What to include in backups
 *
 * Phase 3 Implementation
 */

import { useState, useEffect, useCallback } from "react";
import {
  Archive,
  Clock,
  Save,
  RotateCcw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Database,
  FileBox,
  Info,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getBackupSettings,
  updateBackupSettings,
} from "@/api/client";
import type { BackupSettings as BackupSettingsType } from "@/types/settings";
import { DEFAULT_BACKUP_SETTINGS } from "@/types/settings";

// Interval options in hours
const INTERVAL_OPTIONS = [
  { value: "6", label: "Every 6 hours" },
  { value: "12", label: "Every 12 hours" },
  { value: "24", label: "Daily" },
  { value: "48", label: "Every 2 days" },
  { value: "168", label: "Weekly" },
];

export interface BackupSettingsProps {
  /** Optional class name */
  className?: string;
  /** Callback when settings change */
  onSettingsChange?: () => void;
}

export function BackupSettings({ className, onSettingsChange }: BackupSettingsProps) {
  const [settings, setSettings] = useState<BackupSettingsType>(DEFAULT_BACKUP_SETTINGS);
  const [originalSettings, setOriginalSettings] = useState<BackupSettingsType>(DEFAULT_BACKUP_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getBackupSettings();
      setSettings(data);
      setOriginalSettings(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load backup settings"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Check if settings have changed
  const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);
      await updateBackupSettings(settings);
      setOriginalSettings(settings);
      setSuccessMessage("Backup settings saved successfully");
      onSettingsChange?.();
      // Clear success message after delay
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save settings";
      const apiError = err as { detail?: string };
      setError(apiError.detail || message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevert = () => {
    setSettings(originalSettings);
    setError(null);
  };

  const handleReset = () => {
    setSettings(DEFAULT_BACKUP_SETTINGS);
  };

  // Clear success message after delay
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="h-5 w-5" />
          Scheduled Backups
        </CardTitle>
        <CardDescription>
          Configure automatic workspace backups to protect your work
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable/disable toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Enable Automatic Backups</Label>
            <p className="text-xs text-muted-foreground">
              Automatically create backups at the specified interval
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(checked) =>
              setSettings((prev) => ({ ...prev, enabled: checked }))
            }
            disabled={isSaving}
          />
        </div>

        {/* Settings that only apply when enabled */}
        <div className={`space-y-4 ${!settings.enabled ? "opacity-50" : ""}`}>
          {/* Backup interval */}
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <Label>Backup Interval</Label>
            </div>
            <Select
              value={settings.interval_hours.toString()}
              onValueChange={(value) =>
                setSettings((prev) => ({
                  ...prev,
                  interval_hours: parseInt(value, 10),
                }))
              }
              disabled={!settings.enabled || isSaving}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select interval" />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Max backups */}
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="max-backups">Maximum Backups to Keep</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Older backups will be automatically deleted</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Input
              id="max-backups"
              type="number"
              min={1}
              max={50}
              value={settings.max_backups}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  max_backups: Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 5)),
                }))
              }
              disabled={!settings.enabled || isSaving}
              className="w-24"
            />
          </div>

          {/* What to include */}
          <div className="space-y-3">
            <Label>Include in Backups</Label>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="backup-results"
                checked={settings.include_results}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    include_results: checked === true,
                  }))
                }
                disabled={!settings.enabled || isSaving}
              />
              <div className="grid gap-0.5">
                <Label
                  htmlFor="backup-results"
                  className="text-sm font-medium flex items-center gap-2"
                >
                  <FileBox className="h-4 w-4 text-muted-foreground" />
                  Results & Predictions
                </Label>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="backup-models"
                checked={settings.include_models}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    include_models: checked === true,
                  }))
                }
                disabled={!settings.enabled || isSaving}
              />
              <div className="grid gap-0.5">
                <Label
                  htmlFor="backup-models"
                  className="text-sm font-medium flex items-center gap-2"
                >
                  <Database className="h-4 w-4 text-muted-foreground" />
                  Trained Models
                </Label>
              </div>
            </div>
          </div>
        </div>

        {/* Feedback messages */}
        {successMessage && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 p-2 bg-green-50 dark:bg-green-950/20 rounded">
            <CheckCircle2 className="h-4 w-4" />
            <span>{successMessage}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive p-2 bg-destructive/10 rounded">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            size="sm"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleRevert}
            disabled={!hasChanges || isSaving}
            size="sm"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Revert
          </Button>
          <Button
            variant="ghost"
            onClick={handleReset}
            disabled={isSaving}
            size="sm"
            className="ml-auto"
          >
            Reset to Defaults
          </Button>
        </div>

        {/* Info note */}
        <div className="bg-muted/50 p-3 rounded-md">
          <p className="text-xs text-muted-foreground">
            <strong>Note:</strong> Scheduled backups run when the application is open.
            Backups are stored in the workspace's <code className="text-xs">.backups</code> folder.
            You can also create manual backups from the Workspace Statistics panel.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default BackupSettings;
