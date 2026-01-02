import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Folder,
  File,
  Plus,
  X,
  Info,
  ChevronLeft,
  Loader2,
} from "lucide-react";
import { selectFolder, selectFile, isPyWebView } from "@/utils/fileDialogs";
import type { DatasetFile, DatasetConfig } from "@/types/datasets";

interface AddDatasetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (path: string, config?: Partial<DatasetConfig>) => Promise<void>;
}

type Step = "select" | "configure";

export function AddDatasetModal({
  open,
  onOpenChange,
  onAdd,
}: AddDatasetModalProps) {
  const [step, setStep] = useState<Step>("select");
  const [sourceType, setSourceType] = useState<"folder" | "files" | null>(null);
  const [datasetPath, setDatasetPath] = useState("");
  const [detectedFiles, setDetectedFiles] = useState<DatasetFile[]>([]);
  const [loading, setLoading] = useState(false);

  // CSV config
  const [delimiter, setDelimiter] = useState(";");
  const [decimalSeparator, setDecimalSeparator] = useState(".");
  const [headerType, setHeaderType] = useState<string>("text");

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setStep("select");
      setSourceType(null);
      setDatasetPath("");
      setDetectedFiles([]);
      setDelimiter(";");
      setDecimalSeparator(".");
      setHeaderType("text");
    }
  }, [open]);

  const handleSelectFolder = async () => {
    try {
      const folderPath = await selectFolder();
      if (folderPath && typeof folderPath === "string") {
        setDatasetPath(folderPath);
        setSourceType("folder");
        // Auto-detect files in folder (mock for now)
        setDetectedFiles([
          { path: "X_train.csv", type: "X", split: "train", source: 1, detected: true },
          { path: "Y_train.csv", type: "Y", split: "train", source: null, detected: true },
          { path: "X_test.csv", type: "X", split: "test", source: 1, detected: true },
          { path: "Y_test.csv", type: "Y", split: "test", source: null, detected: true },
        ]);
        setStep("configure");
      }
    } catch (error) {
      console.error("Failed to select folder:", error);
    }
  };

  const handleSelectFiles = async () => {
    try {
      const result = await selectFile(
        ["CSV files (*.csv)", "All files (*.*)"],
        true
      );
      if (result) {
        const files = Array.isArray(result) ? result : [result];
        if (files.length > 0) {
          setDatasetPath(files[0]);
          setSourceType("files");

          // Auto-detect file types from names
          const detectedFiles: DatasetFile[] = files.map((filePath) => {
            const filename = filePath.split(/[/\\]/).pop()?.toLowerCase() || "";
            let type: "X" | "Y" | "metadata" = "X";
            let split: "train" | "test" = "train";
            let source: number | null = null;

            if (filename.includes("y_") || filename.includes("y-")) {
              type = "Y";
            } else if (filename.includes("metadata")) {
              type = "metadata";
            }

            if (filename.includes("test") || filename.includes("val")) {
              split = "test";
            }

            if (type === "X") {
              const sourceMatch = filename.match(/(?:source|s)[\s_-]*(\d+)/i);
              source = sourceMatch ? parseInt(sourceMatch[1]) : 1;
            }

            return { path: filePath, type, split, source, detected: false };
          });

          setDetectedFiles(detectedFiles);
          setStep("configure");
        }
      }
    } catch (error) {
      console.error("Failed to select files:", error);
    }
  };

  const handleAddMoreFiles = async () => {
    try {
      const result = await selectFile(
        ["CSV files (*.csv)", "All files (*.*)"],
        true
      );
      if (result) {
        const newFiles = Array.isArray(result) ? result : [result];
        const maxSource = Math.max(
          0,
          ...detectedFiles.filter((f) => f.type === "X").map((f) => f.source || 0)
        );

        const additional: DatasetFile[] = newFiles.map((filePath, i) => {
          const filename = filePath.split(/[/\\]/).pop()?.toLowerCase() || "";
          let type: "X" | "Y" | "metadata" = "X";
          let split: "train" | "test" = "train";
          let source: number | null = null;

          if (filename.includes("y_") || filename.includes("y-")) {
            type = "Y";
          } else if (filename.includes("metadata")) {
            type = "metadata";
          }

          if (filename.includes("test") || filename.includes("val")) {
            split = "test";
          }

          if (type === "X") {
            source = maxSource + i + 1;
          }

          return { path: filePath, type, split, source, detected: false };
        });

        setDetectedFiles((prev) => [...prev, ...additional]);
      }
    } catch (error) {
      console.error("Failed to add files:", error);
    }
  };

  const updateFile = (
    index: number,
    updates: Partial<DatasetFile>
  ) => {
    setDetectedFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...updates } : f))
    );
  };

  const removeFile = (index: number) => {
    setDetectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!datasetPath) return;

    setLoading(true);
    try {
      const config: Partial<DatasetConfig> = {
        delimiter,
        decimal_separator: decimalSeparator,
        has_header: headerType !== "none",
        header_type: headerType as DatasetConfig["header_type"],
        files: detectedFiles,
      };

      await onAdd(datasetPath, config);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to add dataset:", error);
    } finally {
      setLoading(false);
    }
  };

  const getFileName = (path: string) => path.split(/[/\\]/).pop() || path;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === "select" ? "Add Dataset" : "Configure Dataset"}
          </DialogTitle>
          <DialogDescription>
            {step === "select"
              ? "Choose how to add your spectral dataset"
              : "Configure file mapping and parsing options"}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Select Source */}
        {step === "select" && (
          <div className="py-6">
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={handleSelectFolder}
                className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-lg hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <Folder className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="font-medium text-foreground mb-2">
                  Select Folder
                </h3>
                <p className="text-sm text-muted-foreground text-center">
                  Choose a folder with X_train, Y_train, etc.
                </p>
              </button>

              <button
                onClick={handleSelectFiles}
                className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-lg hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <File className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="font-medium text-foreground mb-2">
                  Select Files
                </h3>
                <p className="text-sm text-muted-foreground text-center">
                  Choose one or more CSV files manually
                </p>
              </button>
            </div>

            {!isPyWebView() && (
              <div className="mt-4 p-3 bg-muted/50 rounded-lg flex items-start gap-2">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  Running in browser mode. For full file system access, use the
                  desktop application.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Configure */}
        {step === "configure" && (
          <div className="flex-1 overflow-hidden flex flex-col gap-4 py-2">
            {/* Path display */}
            <div>
              <Label className="text-sm text-muted-foreground">
                {sourceType === "folder" ? "Folder Path" : "Selected Files"}
              </Label>
              <div className="mt-1 px-3 py-2 bg-muted/50 rounded-md text-sm font-mono truncate">
                {datasetPath}
              </div>
            </div>

            {/* File list */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <Label>Dataset Files</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAddMoreFiles}
                  className="h-7 text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Files
                </Button>
              </div>

              <ScrollArea className="flex-1 border rounded-md">
                <div className="divide-y">
                  {detectedFiles.map((file, idx) => (
                    <div key={idx} className="p-3 hover:bg-muted/30">
                      <div className="flex items-start gap-3">
                        <File className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span
                              className="text-sm truncate flex-1"
                              title={file.path}
                            >
                              {getFileName(file.path)}
                            </span>
                            {file.detected && (
                              <Badge variant="secondary" className="text-xs">
                                Auto
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              onClick={() => removeFile(idx)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <Label className="text-xs text-muted-foreground">
                                Type
                              </Label>
                              <Select
                                value={file.type}
                                onValueChange={(v) =>
                                  updateFile(idx, {
                                    type: v as DatasetFile["type"],
                                    source: v === "X" ? 1 : null,
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="X">X (Spectra)</SelectItem>
                                  <SelectItem value="Y">Y (Analyte)</SelectItem>
                                  <SelectItem value="metadata">
                                    Metadata
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <Label className="text-xs text-muted-foreground">
                                Split
                              </Label>
                              <Select
                                value={file.split}
                                onValueChange={(v) =>
                                  updateFile(idx, {
                                    split: v as DatasetFile["split"],
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="train">Train</SelectItem>
                                  <SelectItem value="test">Test</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <Label className="text-xs text-muted-foreground">
                                Source
                              </Label>
                              {file.type === "X" ? (
                                <Select
                                  value={String(file.source || 1)}
                                  onValueChange={(v) =>
                                    updateFile(idx, { source: parseInt(v) })
                                  }
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {[1, 2, 3, 4, 5].map((n) => (
                                      <SelectItem key={n} value={String(n)}>
                                        Source {n}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <div className="h-8 px-3 flex items-center text-xs text-muted-foreground bg-muted/50 rounded-md">
                                  N/A
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {detectedFiles.length === 0 && (
                    <div className="p-8 text-center text-muted-foreground">
                      No files detected
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* CSV Options */}
            <div className="border-t pt-4">
              <Label className="mb-3 block">CSV Parsing Options</Label>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Delimiter
                  </Label>
                  <Select value={delimiter} onValueChange={setDelimiter}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value=";">Semicolon (;)</SelectItem>
                      <SelectItem value=",">Comma (,)</SelectItem>
                      <SelectItem value="\t">Tab</SelectItem>
                      <SelectItem value="|">Pipe (|)</SelectItem>
                      <SelectItem value=" ">Space</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">
                    Decimal
                  </Label>
                  <Select
                    value={decimalSeparator}
                    onValueChange={setDecimalSeparator}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value=".">Dot (.)</SelectItem>
                      <SelectItem value=",">Comma (,)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">
                    Header
                  </Label>
                  <Select value={headerType} onValueChange={setHeaderType}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="nm">Wavelength (nm)</SelectItem>
                      <SelectItem value="cm-1">Wavenumber (cm⁻¹)</SelectItem>
                      <SelectItem value="text">Text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === "configure" && (
            <Button
              variant="ghost"
              onClick={() => setStep("select")}
              className="mr-auto"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {step === "configure" && (
            <Button
              onClick={handleSubmit}
              disabled={loading || detectedFiles.length === 0}
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Dataset
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
