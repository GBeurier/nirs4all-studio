/**
 * Config Path Settings Component
 *
 * Allows users to view and change the app config folder path.
 * The config folder stores global settings like linked datasets and UI preferences.
 */

import { useState, useEffect } from "react";
import { FolderCog, RotateCcw, FolderOpen, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { selectFolder } from "@/utils/fileDialogs";
import {
  getConfigPath,
  setConfigPath,
  resetConfigPath,
  type ConfigPathResponse,
} from "@/api/client";

export function ConfigPathSettings() {
  const [configPath, setConfigPathState] = useState<ConfigPathResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadConfigPath();
  }, []);

  const loadConfigPath = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getConfigPath();
      setConfigPathState(response);
      setNewPath(response.current_path);
    } catch (err) {
      console.error("Failed to load config path:", err);
      setError("Failed to load config path settings");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBrowse = async () => {
    try {
      const selected = await selectFolder();
      if (selected) {
        setNewPath(selected);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
    }
  };

  const handleSave = async () => {
    if (!newPath || newPath === configPath?.current_path) return;

    try {
      setIsSaving(true);
      setError(null);
      setSuccess(null);
      const response = await setConfigPath(newPath);
      if (response.success) {
        setConfigPathState({
          current_path: response.current_path,
          default_path: configPath?.default_path || "",
          is_custom: true,
        });
        setSuccess(
          response.requires_restart
            ? "Config path updated. Please restart the application for changes to take full effect."
            : "Config path has been updated."
        );
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Failed to set config path";
      if (typeof err === "object" && err !== null && "detail" in err) {
        setError(String((err as { detail: string }).detail));
      } else {
        setError(errorMsg);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      setIsSaving(true);
      setError(null);
      setSuccess(null);
      const response = await resetConfigPath();
      if (response.success) {
        setConfigPathState({
          current_path: response.current_path,
          default_path: response.current_path,
          is_custom: false,
        });
        setNewPath(response.current_path);
        setSuccess(
          response.requires_restart
            ? "Config path reset to default. Please restart the application for changes to take full effect."
            : "Config path has been reset to default."
        );
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Failed to reset config path";
      if (typeof err === "object" && err !== null && "detail" in err) {
        setError(String((err as { detail: string }).detail));
      } else {
        setError(errorMsg);
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderCog className="h-5 w-5" />
            App Config Folder
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse h-20 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderCog className="h-5 w-5" />
          App Config Folder
          {configPath?.is_custom && (
            <Badge variant="secondary" className="ml-2">Custom</Badge>
          )}
        </CardTitle>
        <CardDescription>
          The config folder stores global settings like linked datasets, UI preferences, and workspace links.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label>Current Config Path</Label>
          <div className="flex gap-2">
            <Input
              value={newPath}
              onChange={(e) => {
                setNewPath(e.target.value);
                setError(null);
                setSuccess(null);
              }}
              placeholder={configPath?.default_path || ""}
              className="font-mono text-sm"
            />
            <Button variant="outline" onClick={handleBrowse} disabled={isSaving}>
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
          {configPath?.is_custom && configPath?.default_path && (
            <p className="text-xs text-muted-foreground">
              Default: <span className="font-mono">{configPath.default_path}</span>
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={isSaving || newPath === configPath?.current_path || !newPath}
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>

          {configPath?.is_custom && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={isSaving}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset to Default
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset Config Path?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will reset the config folder to the default location:
                    <br />
                    <code className="text-sm bg-muted px-1 py-0.5 rounded">
                      {configPath?.default_path}
                    </code>
                    <br /><br />
                    Your existing config files at the custom location will not be deleted,
                    but the app will use the default location after restart.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleReset}>
                    Reset
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          <strong>Tip:</strong> You can also set the config path using the{" "}
          <code className="bg-muted px-1 py-0.5 rounded">NIRS4ALL_CONFIG</code>{" "}
          environment variable before starting the application.
        </p>
      </CardContent>
    </Card>
  );
}
