/**
 * Batch Scan Dialog
 *
 * Recursively scans a folder for datasets, shows results,
 * and allows importing selected datasets with auto-created groups.
 */

import { useState, useCallback } from "react";
import {
  FolderSearch,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileSpreadsheet,
  FolderTree,
  Import,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  scanFolder,
  linkDataset,
  createGroup,
  addDatasetToGroup,
  getGroups,
} from "@/api/client";
import type { ScannedDataset } from "@/types/datasets";

type Phase = "confirm" | "scanning" | "results" | "importing" | "done";

interface ImportResult {
  datasetName: string;
  success: boolean;
  error?: string;
}

interface BatchScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderPath: string;
  onComplete: () => void;
}

export function BatchScanDialog({
  open,
  onOpenChange,
  folderPath,
  onComplete,
}: BatchScanDialogProps) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [scannedDatasets, setScannedDatasets] = useState<ScannedDataset[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [totalScanned, setTotalScanned] = useState(0);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [importProgress, setImportProgress] = useState(0);

  const folderName = folderPath.split(/[/\\]/).filter(Boolean).pop() || "folder";

  const handleScan = useCallback(async () => {
    setPhase("scanning");
    try {
      const result = await scanFolder(folderPath);
      setScannedDatasets(result.datasets);
      setTotalScanned(result.total_scanned_folders);
      setScanWarnings(result.warnings);
      // Select all by default
      setSelectedIndices(new Set(result.datasets.map((_, i) => i)));
      setPhase("results");
    } catch (err) {
      setScanWarnings([`Scan failed: ${err instanceof Error ? err.message : String(err)}`]);
      setPhase("results");
    }
  }, [folderPath]);

  const handleToggle = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleToggleAll = () => {
    if (selectedIndices.size === scannedDatasets.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(scannedDatasets.map((_, i) => i)));
    }
  };

  const handleImport = useCallback(async () => {
    setPhase("importing");
    const results: ImportResult[] = [];
    const selectedDatasets = scannedDatasets.filter((_, i) => selectedIndices.has(i));

    // Collect all unique group names needed
    const allGroupNames = new Set<string>();
    for (const ds of selectedDatasets) {
      for (const g of ds.groups) {
        allGroupNames.add(g);
      }
    }

    // Get existing groups and create missing ones
    const groupNameToId: Record<string, string> = {};
    try {
      const existingGroups = await getGroups();
      for (const g of existingGroups.groups) {
        groupNameToId[g.name] = g.id;
      }
    } catch {
      // Continue without existing groups
    }

    for (const name of allGroupNames) {
      if (!groupNameToId[name]) {
        try {
          const created = await createGroup(name);
          groupNameToId[name] = created.group.id;
        } catch {
          // If creation fails, skip group assignment
        }
      }
    }

    // Import each dataset
    for (let i = 0; i < selectedDatasets.length; i++) {
      const ds = selectedDatasets[i];
      setImportProgress(i + 1);

      try {
        // Build config using files array format (preferred by _build_nirs4all_config_from_stored)
        const config: Record<string, unknown> = {};
        if (Object.keys(ds.parsing_options).length > 0) {
          config.global_params = ds.parsing_options;
          // Also set top-level parsing keys for compatibility
          const po = ds.parsing_options;
          if (po.delimiter) config.delimiter = po.delimiter;
          if (po.decimal_separator) config.decimal_separator = po.decimal_separator;
          if (po.has_header !== undefined) config.has_header = po.has_header;
          if (po.header_unit) config.header_unit = po.header_unit;
          if (po.signal_type) config.signal_type = po.signal_type;
        }

        // Use files array format for robust multi-source handling
        config.files = ds.files.map((f) => ({
          path: f.path,
          type: f.type,
          split: f.split,
          source: f.source,
        }));

        if (ds.has_fold_file && ds.fold_file_path) {
          config.folds = ds.fold_file_path;
        }

        const linked = await linkDataset(ds.folder_path, config);

        // Assign groups
        if (linked.success && linked.dataset?.id) {
          for (const groupName of ds.groups) {
            const gid = groupNameToId[groupName];
            if (gid) {
              try {
                await addDatasetToGroup(gid, linked.dataset.id);
              } catch {
                // Non-critical
              }
            }
          }
        }

        results.push({ datasetName: ds.folder_name, success: true });
      } catch (err) {
        results.push({
          datasetName: ds.folder_name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    setImportResults(results);
    setPhase("done");
  }, [scannedDatasets, selectedIndices]);

  const handleClose = () => {
    if (phase === "done") {
      onComplete();
    }
    onOpenChange(false);
    // Reset state
    setTimeout(() => {
      setPhase("confirm");
      setScannedDatasets([]);
      setSelectedIndices(new Set());
      setImportResults([]);
      setImportProgress(0);
      setScanWarnings([]);
    }, 200);
  };

  const successCount = importResults.filter((r) => r.success).length;
  const failCount = importResults.filter((r) => !r.success).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderSearch className="h-5 w-5" />
            Batch Folder Scan
          </DialogTitle>
          <DialogDescription>
            {phase === "confirm" && `Scan "${folderName}" for datasets in subfolders`}
            {phase === "scanning" && "Scanning subfolders..."}
            {phase === "results" && `Found ${scannedDatasets.length} datasets in ${totalScanned} folders`}
            {phase === "importing" && `Importing ${importProgress} of ${selectedIndices.size} datasets...`}
            {phase === "done" && `Import complete: ${successCount} succeeded, ${failCount} failed`}
          </DialogDescription>
        </DialogHeader>

        {/* Confirm phase */}
        {phase === "confirm" && (
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              No dataset files were detected directly in this folder.
              Would you like to recursively scan subfolders for datasets?
            </p>
            <p className="text-sm text-muted-foreground">
              Datasets will be named after their folder. Parent folder names will be used as groups.
            </p>
            <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
              <FolderTree className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <code className="text-xs font-mono truncate">{folderPath}</code>
            </div>
          </div>
        )}

        {/* Scanning phase */}
        {phase === "scanning" && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Scanning subfolders for datasets...</p>
          </div>
        )}

        {/* Results phase */}
        {phase === "results" && (
          <div className="space-y-3">
            {scanWarnings.length > 0 && (
              <div className="flex items-start gap-2 p-2 bg-yellow-500/10 rounded text-sm">
                <AlertCircle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  {scanWarnings.map((w, i) => (
                    <p key={i} className="text-yellow-700 dark:text-yellow-400">{w}</p>
                  ))}
                </div>
              </div>
            )}

            {scannedDatasets.length > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleToggleAll}
                    className="text-xs text-primary hover:underline"
                  >
                    {selectedIndices.size === scannedDatasets.length ? "Deselect all" : "Select all"}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {selectedIndices.size} of {scannedDatasets.length} selected
                  </span>
                </div>
                <ScrollArea className="h-[350px]">
                  <div className="space-y-2 pr-3">
                    {scannedDatasets.map((ds, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                          selectedIndices.has(i)
                            ? "border-primary/30 bg-primary/5"
                            : "border-border hover:border-border/80"
                        }`}
                        onClick={() => handleToggle(i)}
                      >
                        <Checkbox
                          checked={selectedIndices.has(i)}
                          onCheckedChange={() => handleToggle(i)}
                        />
                        <FileSpreadsheet className="h-4 w-4 text-primary flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{ds.folder_name}</span>
                            {ds.groups.map((g) => (
                              <Badge
                                key={g}
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0"
                              >
                                {g}
                              </Badge>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {ds.files.length} files
                            {ds.files.filter(f => f.type === "X").map(f =>
                              f.num_rows ? ` \u00b7 ${f.num_rows} samples` : ""
                            ).join("")}
                            {ds.has_fold_file ? " \u00b7 folds" : ""}
                          </p>
                        </div>
                        {ds.warnings.length > 0 && (
                          <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                <FolderSearch className="h-8 w-8" />
                <p className="text-sm">No datasets found in subfolders</p>
              </div>
            )}
          </div>
        )}

        {/* Importing phase */}
        {phase === "importing" && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Importing dataset {importProgress} of {selectedIndices.size}...
            </p>
            <div className="w-full max-w-xs bg-muted rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${(importProgress / selectedIndices.size) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Done phase */}
        {phase === "done" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 py-2">
              {failCount === 0 ? (
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              ) : (
                <AlertCircle className="h-6 w-6 text-yellow-500" />
              )}
              <div>
                <p className="font-medium">
                  {failCount === 0
                    ? `All ${successCount} datasets imported successfully`
                    : `${successCount} imported, ${failCount} failed`}
                </p>
              </div>
            </div>
            <ScrollArea className="h-[250px]">
              <div className="space-y-1 pr-3">
                {importResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded text-sm">
                    {r.success ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                    )}
                    <span className={r.success ? "" : "text-destructive"}>{r.datasetName}</span>
                    {r.error && (
                      <span className="text-xs text-muted-foreground truncate ml-auto">
                        {r.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          {phase === "confirm" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleScan}>
                <FolderSearch className="h-4 w-4 mr-2" />
                Scan
              </Button>
            </>
          )}
          {phase === "results" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={selectedIndices.size === 0}
              >
                <Import className="h-4 w-4 mr-2" />
                Import {selectedIndices.size > 0 ? `${selectedIndices.size} Datasets` : ""}
              </Button>
            </>
          )}
          {phase === "done" && (
            <Button onClick={handleClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
