/**
 * RelinkDialog - Phase 2: Versioning & Integrity
 *
 * Dialog to relink a dataset to a new path.
 * Used when dataset path is missing or needs to be updated.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2, FolderOpen, AlertTriangle, Check, X } from "lucide-react";
import { selectFolder } from "@/utils/fileDialogs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Dataset } from "@/types/datasets";

interface RelinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: Dataset;
  onRelink: (newPath: string, force: boolean) => Promise<void>;
  isLoading?: boolean;
}

interface ValidationResult {
  structure_matches: boolean;
  file_count_matches: boolean;
  warnings: string[];
}

export function RelinkDialog({
  open,
  onOpenChange,
  dataset,
  onRelink,
  isLoading = false,
}: RelinkDialogProps) {
  const { t } = useTranslation();
  const [newPath, setNewPath] = useState("");
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      // Reset state when closing
      setNewPath("");
      setForce(false);
      setError(null);
      setValidation(null);
    }
    onOpenChange(isOpen);
  };

  const handleBrowse = async () => {
    try {
      const result = await selectFolder();
      if (result) {
        setNewPath(result);
        setError(null);
      }
    } catch {
      // Fall back to manual input
    }
  };

  const handleRelink = async () => {
    if (!newPath.trim()) {
      setError(t("datasets.relink.enterPath"));
      return;
    }

    setError(null);
    setValidation(null);

    try {
      await onRelink(newPath.trim(), force);
      handleOpenChange(false);
    } catch (err) {
      if (err instanceof Error) {
        // Check if it's a validation error
        if (err.message.includes("Structure validation failed")) {
          setError(err.message);
          setValidation({
            structure_matches: false,
            file_count_matches: false,
            warnings: [],
          });
        } else {
          setError(err.message);
        }
      } else {
        setError(t("datasets.relink.failed"));
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            {t("datasets.relink.title")}
          </DialogTitle>
          <DialogDescription>
            {t("datasets.relink.description", { name: dataset.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current path */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t("datasets.relink.currentPath")}</Label>
            <div className="rounded-md border bg-muted/50 p-2">
              <p className="text-sm font-mono break-all text-muted-foreground">
                {dataset.path}
              </p>
            </div>
          </div>

          {/* New path input */}
          <div className="space-y-2">
            <Label htmlFor="new-path">{t("datasets.relink.newPath")}</Label>
            <div className="flex gap-2">
              <Input
                id="new-path"
                placeholder="/path/to/dataset"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                className="flex-1 font-mono text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleBrowse}
                title={t("datasets.relink.browse")}
                aria-label={t("datasets.relink.browse")}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Validation indicators */}
          {validation && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                {validation.structure_matches ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <X className="h-4 w-4 text-red-500" />
                )}
                <span>{t("datasets.relink.structureMatches")}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {validation.file_count_matches ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <X className="h-4 w-4 text-amber-500" />
                )}
                <span>{t("datasets.relink.fileCountMatches")}</span>
              </div>
              {validation.warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-2">
                  <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-1">
                    {validation.warnings.map((warning, i) => (
                      <li key={i}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Force option */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="force"
              checked={force}
              onCheckedChange={(checked) => setForce(checked === true)}
            />
            <Label htmlFor="force" className="text-sm font-normal cursor-pointer">
              {t("datasets.relink.force")}
            </Label>
          </div>

          {/* Error display */}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={handleRelink} disabled={isLoading || !newPath.trim()}>
            {isLoading ? (
              t("datasets.relink.relinking")
            ) : (
              <>
                <Link2 className="h-4 w-4 mr-2" />
                {t("datasets.relink.title")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
