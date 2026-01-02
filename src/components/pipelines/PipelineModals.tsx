/**
 * Pipeline modals (Import, Delete Confirmation, Export)
 * Phase 6: Pipelines Library
 */

import { useState, useCallback } from "react";
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
        setError("Invalid JSON format");
      }
    };
    reader.onerror = () => {
      setError("Failed to read file");
    };
    reader.readAsText(file);
  }, []);

  const handleImport = async () => {
    if (!jsonContent.trim()) {
      setError("Please provide pipeline JSON content");
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
        setError("Failed to import pipeline");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
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
            Import Pipeline
          </DialogTitle>
          <DialogDescription>
            Import a pipeline from a JSON file. The pipeline will be added to your library.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File upload */}
          <div className="space-y-2">
            <Label htmlFor="pipeline-file">Upload JSON file</Label>
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
            <Label htmlFor="pipeline-json">Or paste JSON content</Label>
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
                      return `Pipeline: ${data.name || "Unnamed"} (${data.steps?.length || 0} steps)`;
                    } catch {
                      return "Invalid JSON";
                    }
                  })()}
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={loading || !jsonContent.trim()}>
            {loading ? "Importing..." : "Import Pipeline"}
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
            Delete Pipeline
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete{" "}
            <span className="font-semibold text-foreground">
              {pipeline?.name || "this pipeline"}
            </span>
            ? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? "Deleting..." : "Delete"}
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
            Export Pipeline
          </DialogTitle>
          <DialogDescription>
            Export "{pipeline?.name}" as a JSON file for backup or sharing.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="relative">
            <pre className="p-4 rounded-lg bg-muted/50 border border-border/50 text-xs font-mono overflow-auto max-h-80">
              {jsonContent || "Loading..."}
            </pre>
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2"
              onClick={handleCopy}
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
            Close
          </Button>
          <Button onClick={handleDownload} className="gap-2">
            <Download className="h-4 w-4" />
            Download JSON
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
