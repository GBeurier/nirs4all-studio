/**
 * ExportImportDialog Component
 *
 * Provides enhanced export/import functionality for workspaces with:
 * - Export progress indicator
 * - Export summary display
 * - Import from archive capability
 *
 * Phase 3 Implementation
 */

import { useState } from "react";
import {
  Download,
  Upload,
  FolderOpen,
  FileArchive,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileBox,
  Database,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { selectFile, selectFolder, saveFile } from "@/utils/fileDialogs";
import { formatBytes } from "@/utils/formatters";
import {
  exportWorkspace,
  importWorkspace,
  selectWorkspace,
} from "@/api/client";
import type {
  ExportWorkspaceResponse,
  ImportWorkspaceResponse,
} from "@/types/settings";

interface ExportPanelProps {
  onSuccess: (result: ExportWorkspaceResponse) => void;
  onError: (error: string) => void;
}

function ExportPanel({ onSuccess, onError }: ExportPanelProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [outputPath, setOutputPath] = useState("");
  const [includeModels, setIncludeModels] = useState(true);
  const [includeResults, setIncludeResults] = useState(true);
  const [includeDatasets, setIncludeDatasets] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleBrowse = async () => {
    const path = await saveFile("workspace_export.zip", [".zip"]);
    if (path) {
      setOutputPath(path);
    }
  };

  const handleExport = async () => {
    if (!outputPath.trim()) {
      onError("Please specify an output path");
      return;
    }

    try {
      setIsExporting(true);
      setProgress(10);

      // Simulate progress during export
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const result = await exportWorkspace({
        output_path: outputPath,
        include_models: includeModels,
        include_results: includeResults,
        include_datasets: includeDatasets,
      });

      clearInterval(progressInterval);
      setProgress(100);

      onSuccess(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      const apiError = err as { detail?: string };
      onError(apiError.detail || message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Output path */}
      <div className="space-y-2">
        <Label htmlFor="export-path">Export Location</Label>
        <div className="flex gap-2">
          <Input
            id="export-path"
            placeholder="/path/to/workspace_export.zip"
            value={outputPath}
            onChange={(e) => setOutputPath(e.target.value)}
            className="flex-1"
            disabled={isExporting}
          />
          <Button
            variant="outline"
            onClick={handleBrowse}
            disabled={isExporting}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            Browse
          </Button>
        </div>
      </div>

      {/* Export options */}
      <div className="space-y-3">
        <Label>Include in Export</Label>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="export-models"
            checked={includeModels}
            onCheckedChange={(checked) => setIncludeModels(checked === true)}
            disabled={isExporting}
          />
          <div className="grid gap-0.5">
            <Label htmlFor="export-models" className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              Trained Models
            </Label>
            <span className="text-xs text-muted-foreground">
              Include model files (.n4a, .pkl, etc.)
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="export-results"
            checked={includeResults}
            onCheckedChange={(checked) => setIncludeResults(checked === true)}
            disabled={isExporting}
          />
          <div className="grid gap-0.5">
            <Label htmlFor="export-results" className="text-sm font-medium flex items-center gap-2">
              <FileBox className="h-4 w-4 text-muted-foreground" />
              Results & Predictions
            </Label>
            <span className="text-xs text-muted-foreground">
              Include results and prediction files
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="export-datasets"
            checked={includeDatasets}
            onCheckedChange={(checked) => setIncludeDatasets(checked === true)}
            disabled={isExporting}
          />
          <div className="grid gap-0.5">
            <Label htmlFor="export-datasets" className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Dataset Files
            </Label>
            <span className="text-xs text-muted-foreground text-amber-600">
              ⚠️ May significantly increase archive size
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {isExporting && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Exporting...</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* Export button */}
      <Button
        onClick={handleExport}
        disabled={!outputPath.trim() || isExporting}
        className="w-full"
      >
        {isExporting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Exporting...
          </>
        ) : (
          <>
            <Download className="mr-2 h-4 w-4" />
            Export Workspace
          </>
        )}
      </Button>
    </div>
  );
}

interface ImportPanelProps {
  onSuccess: (result: ImportWorkspaceResponse) => void;
  onError: (error: string) => void;
}

function ImportPanel({ onSuccess, onError }: ImportPanelProps) {
  const [isImporting, setIsImporting] = useState(false);
  const [archivePath, setArchivePath] = useState("");
  const [destinationPath, setDestinationPath] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [progress, setProgress] = useState(0);

  const handleBrowseArchive = async () => {
    const path = await selectFile([".zip"], false);
    if (path && typeof path === "string") {
      setArchivePath(path);
      // Extract suggested name from archive
      const fileName = path.split(/[/\\]/).pop() || "";
      const suggestedName = fileName.replace(/\.zip$/i, "");
      if (!workspaceName) {
        setWorkspaceName(suggestedName);
      }
    }
  };

  const handleBrowseDestination = async () => {
    const path = await selectFolder();
    if (path) {
      setDestinationPath(path);
    }
  };

  const handleImport = async () => {
    if (!archivePath.trim()) {
      onError("Please select an archive file");
      return;
    }
    if (!destinationPath.trim()) {
      onError("Please specify a destination folder");
      return;
    }

    try {
      setIsImporting(true);
      setProgress(10);

      // Simulate progress during import
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 15, 90));
      }, 200);

      const result = await importWorkspace({
        archive_path: archivePath,
        destination_path: destinationPath,
        workspace_name: workspaceName || undefined,
      });

      clearInterval(progressInterval);
      setProgress(100);

      onSuccess(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      const apiError = err as { detail?: string };
      onError(apiError.detail || message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Archive file */}
      <div className="space-y-2">
        <Label htmlFor="import-archive">Archive File</Label>
        <div className="flex gap-2">
          <Input
            id="import-archive"
            placeholder="/path/to/workspace.zip"
            value={archivePath}
            onChange={(e) => setArchivePath(e.target.value)}
            className="flex-1"
            disabled={isImporting}
          />
          <Button
            variant="outline"
            onClick={handleBrowseArchive}
            disabled={isImporting}
          >
            <FileArchive className="mr-2 h-4 w-4" />
            Select
          </Button>
        </div>
      </div>

      {/* Destination folder */}
      <div className="space-y-2">
        <Label htmlFor="import-destination">Destination Folder</Label>
        <div className="flex gap-2">
          <Input
            id="import-destination"
            placeholder="/path/to/destination"
            value={destinationPath}
            onChange={(e) => setDestinationPath(e.target.value)}
            className="flex-1"
            disabled={isImporting}
          />
          <Button
            variant="outline"
            onClick={handleBrowseDestination}
            disabled={isImporting}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            Browse
          </Button>
        </div>
      </div>

      {/* Workspace name */}
      <div className="space-y-2">
        <Label htmlFor="import-name">Workspace Name (optional)</Label>
        <Input
          id="import-name"
          placeholder="Extracted from archive or folder name"
          value={workspaceName}
          onChange={(e) => setWorkspaceName(e.target.value)}
          disabled={isImporting}
        />
      </div>

      {/* Progress bar */}
      {isImporting && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Importing...</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* Import button */}
      <Button
        onClick={handleImport}
        disabled={!archivePath.trim() || !destinationPath.trim() || isImporting}
        className="w-full"
      >
        {isImporting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Importing...
          </>
        ) : (
          <>
            <Upload className="mr-2 h-4 w-4" />
            Import Workspace
          </>
        )}
      </Button>
    </div>
  );
}

export interface ExportImportDialogProps {
  /** Callback when export/import completes */
  onComplete?: () => void;
  /** Button trigger element (optional) */
  trigger?: React.ReactNode;
  /** Default tab to show */
  defaultTab?: "export" | "import";
}

export function ExportImportDialog({
  onComplete,
  trigger,
  defaultTab = "export",
}: ExportImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<ExportWorkspaceResponse | null>(null);
  const [importResult, setImportResult] = useState<ImportWorkspaceResponse | null>(null);

  const resetState = () => {
    setError(null);
    setExportResult(null);
    setImportResult(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetState();
    }
  };

  const handleExportSuccess = (result: ExportWorkspaceResponse) => {
    setExportResult(result);
    onComplete?.();
  };

  const handleImportSuccess = async (result: ImportWorkspaceResponse) => {
    setImportResult(result);
    // Switch to the imported workspace
    await selectWorkspace(result.workspace_path);
    onComplete?.();
    // Reload after a short delay
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  const handleError = (message: string) => {
    setError(message);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export/Import
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Export / Import Workspace
          </DialogTitle>
          <DialogDescription>
            Export your workspace for backup or sharing, or import an existing workspace archive.
          </DialogDescription>
        </DialogHeader>

        {/* Success display for export */}
        {exportResult && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Export completed successfully!</span>
            </div>
            <div className="bg-muted p-4 rounded-md space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Archive:</span>
                <span className="font-mono text-xs truncate max-w-[250px]">
                  {exportResult.output_path}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Size:</span>
                <span className="font-medium">
                  {formatBytes(exportResult.archive_size_bytes)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items exported:</span>
                <span className="font-medium">{exportResult.items_exported}</span>
              </div>
            </div>
          </div>
        )}

        {/* Success display for import */}
        {importResult && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Import completed successfully!</span>
            </div>
            <div className="bg-muted p-4 rounded-md space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Workspace:</span>
                <span className="font-medium">{importResult.workspace_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Path:</span>
                <span className="font-mono text-xs truncate max-w-[250px]">
                  {importResult.workspace_path}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items imported:</span>
                <span className="font-medium">{importResult.items_imported}</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Switching to the imported workspace...
            </p>
          </div>
        )}

        {/* Error display */}
        {error && !exportResult && !importResult && (
          <div className="flex items-center gap-2 text-sm text-destructive p-3 bg-destructive/10 rounded-md">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Tabs for export/import */}
        {!exportResult && !importResult && (
          <Tabs defaultValue={defaultTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="export">
                <Download className="mr-2 h-4 w-4" />
                Export
              </TabsTrigger>
              <TabsTrigger value="import">
                <Upload className="mr-2 h-4 w-4" />
                Import
              </TabsTrigger>
            </TabsList>
            <TabsContent value="export" className="mt-4">
              <ExportPanel
                onSuccess={handleExportSuccess}
                onError={handleError}
              />
            </TabsContent>
            <TabsContent value="import" className="mt-4">
              <ImportPanel
                onSuccess={handleImportSuccess}
                onError={handleError}
              />
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          {(exportResult || importResult) && (
            <Button onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ExportImportDialog;
