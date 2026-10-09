/**
 * Pipeline modals (Import, Delete Confirmation, Export)
 * Phase 6: Pipelines Library
 */

import { useState, useCallback } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, FileJson, AlertTriangle, Download, Copy, Check } from "lucide-react";
import type { Pipeline } from "@/types/pipelines";

// ===================== Import Pipeline Modal =====================

interface ImportPipelineModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (jsonString: string) => Promise<Pipeline | null>;
}

export function ImportPipelineModal({
  open,
  onOpenChange,
  onImport,
}: ImportPipelineModalProps) {
  const { t } = useTranslation();
  const [jsonContent, setJsonContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setJsonContent(content);
      setError(null);

      // Validate JSON
      try {
        JSON.parse(content);
      } catch {
        setError(t("pipelines.modals.import.invalidJson"));
      }
    };
    reader.onerror = () => {
      setError(t("pipelines.modals.import.readFailed"));
    };
    reader.readAsText(file);
  }, [t]);

  const handleImport = async () => {
    if (!jsonContent.trim()) {
      setError(t("pipelines.modals.import.emptyContent"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await onImport(jsonContent);
      if (result) {
        setJsonContent("");
        onOpenChange(false);
      } else {
        setError(t("pipelines.modals.import.failed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pipelines.modals.import.importFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setJsonContent("");
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            {t("pipelines.importPipeline")}
          </DialogTitle>
          <DialogDescription>
            {t("pipelines.modals.import.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File upload */}
          <div className="space-y-2">
            <Label htmlFor="pipeline-file">{t("pipelines.modals.import.uploadLabel")}</Label>
            <Input
              id="pipeline-file"
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="cursor-pointer"
            />
          </div>

          {/* Or paste JSON */}
          <div className="space-y-2">
            <Label htmlFor="pipeline-json">{t("pipelines.modals.import.pasteLabel")}</Label>
            <textarea
              id="pipeline-json"
              value={jsonContent}
              onChange={(e) => {
                setJsonContent(e.target.value);
                setError(null);
              }}
              placeholder='{"name": "My Pipeline", "steps": [...], ...}'
              className="w-full h-40 px-3 py-2 text-sm rounded-md border border-input bg-background font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Error display */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* Preview */}
          {jsonContent && !error && (
            <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileJson className="h-4 w-4" />
                <span>
                  {(() => {
                    try {
                      const data = JSON.parse(jsonContent);
                      return t("pipelines.modals.import.preview", {
                        name: data.name || t("pipelines.modals.import.unnamed"),
                        count: data.steps?.length || 0,
                      });
                    } catch {
                      return t("pipelines.modals.import.invalidPreview");
                    }
                  })()}
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleImport} disabled={loading || !jsonContent.trim()}>
            {loading ? t("pipelines.modals.import.importing") : t("pipelines.importPipeline")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===================== Delete Pipeline Dialog =====================

interface DeletePipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: Pipeline | null;
  onConfirm: () => Promise<void>;
}

export function DeletePipelineDialog({
  open,
  onOpenChange,
  pipeline,
  onConfirm,
}: DeletePipelineDialogProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to delete pipeline:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {t("pipelines.modals.delete.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans
              i18nKey="pipelines.modals.delete.description"
              values={{ name: pipeline?.name || t("pipelines.modals.delete.thisPipeline") }}
              components={{ strong: <span className="font-semibold text-foreground" /> }}
            />
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? t("pipelines.modals.delete.deleting") : t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ===================== Export Pipeline Dialog =====================

interface ExportPipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: Pipeline | null;
  jsonContent: string | null;
}

export function ExportPipelineDialog({
  open,
  onOpenChange,
  pipeline,
  jsonContent,
}: ExportPipelineDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!jsonContent) return;

    try {
      await navigator.clipboard.writeText(jsonContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [jsonContent]);

  const handleDownload = useCallback(() => {
    if (!jsonContent || !pipeline) return;

    const blob = new Blob([jsonContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pipeline.name.replace(/\s+/g, "_").toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [jsonContent, pipeline]);

  const handleClose = () => {
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            {t("pipelines.modals.export.title")}
          </DialogTitle>
          <DialogDescription>
            {t("pipelines.modals.export.description", { name: pipeline?.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="relative">
            <pre className="p-4 rounded-lg bg-muted/50 border border-border/50 text-xs font-mono overflow-auto max-h-80">
              {jsonContent || t("pipelines.modals.export.loading")}
            </pre>
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2"
              onClick={handleCopy}
              aria-label={t("pipelines.modals.export.copy")}
            >
              {copied ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t("common.close")}
          </Button>
          <Button onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" />
            {t("pipelines.modals.export.download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
