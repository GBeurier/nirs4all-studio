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
import { Loader2, Info, FolderOpen } from "lucide-react";
import type { Dataset, DatasetConfig } from "@/types/datasets";

interface EditDatasetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: Dataset | null;
  onSave: (datasetId: string, config: Partial<DatasetConfig>) => Promise<void>;
}

export function EditDatasetModal({
  open,
  onOpenChange,
  dataset,
  onSave,
}: EditDatasetModalProps) {
  const [loading, setLoading] = useState(false);

  // Config state
  const [delimiter, setDelimiter] = useState(";");
  const [decimalSeparator, setDecimalSeparator] = useState(".");
  const [headerType, setHeaderType] = useState<string>("text");

  // File paths (optional overrides)
  const [trainXPath, setTrainXPath] = useState("");
  const [trainYPath, setTrainYPath] = useState("");
  const [testXPath, setTestXPath] = useState("");
  const [testYPath, setTestYPath] = useState("");
  const [trainGroupPath, setTrainGroupPath] = useState("");
  const [testGroupPath, setTestGroupPath] = useState("");

  // Load existing config when dataset changes
  useEffect(() => {
    if (dataset?.config) {
      const cfg = dataset.config;
      setDelimiter(cfg.delimiter || ";");
      setDecimalSeparator(cfg.decimal_separator || ".");
      setHeaderType(
        cfg.has_header === false
          ? "none"
          : cfg.header_type || "text"
      );
      setTrainXPath(cfg.train_x || "");
      setTrainYPath(cfg.train_y || "");
      setTestXPath(cfg.test_x || "");
      setTestYPath(cfg.test_y || "");
      setTrainGroupPath(cfg.train_group || "");
      setTestGroupPath(cfg.test_group || "");
    } else {
      // Reset to defaults
      setDelimiter(";");
      setDecimalSeparator(".");
      setHeaderType("text");
      setTrainXPath("");
      setTrainYPath("");
      setTestXPath("");
      setTestYPath("");
      setTrainGroupPath("");
      setTestGroupPath("");
    }
  }, [dataset]);

  const handleSave = async () => {
    if (!dataset) return;

    setLoading(true);
    try {
      const config: Partial<DatasetConfig> = {
        delimiter,
        decimal_separator: decimalSeparator,
        has_header: headerType !== "none",
        header_type: headerType as DatasetConfig["header_type"],
      };

      // Add file paths if specified
      if (trainXPath) config.train_x = trainXPath;
      if (trainYPath) config.train_y = trainYPath;
      if (testXPath) config.test_x = testXPath;
      if (testYPath) config.test_y = testYPath;
      if (trainGroupPath) config.train_group = trainGroupPath;
      if (testGroupPath) config.test_group = testGroupPath;

      await onSave(dataset.id, config);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save dataset config:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!dataset) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Dataset Configuration</DialogTitle>
          <DialogDescription>{dataset.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Path (read-only) */}
          <div>
            <Label className="text-sm text-muted-foreground">
              Dataset Path
            </Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                value={dataset.path}
                readOnly
                className="flex-1 bg-muted/50 font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  if (dataset.path) {
                    window.open(`file://${dataset.path}`, "_blank");
                  }
                }}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              To use a different path, add a new dataset
            </p>
          </div>

          {/* CSV Parsing Options */}
          <div className="border-t pt-4">
            <Label className="text-base font-medium">CSV Parsing Options</Label>
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div>
                <Label className="text-sm text-muted-foreground">
                  Delimiter
                </Label>
                <Select value={delimiter} onValueChange={setDelimiter}>
                  <SelectTrigger className="mt-1">
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
                <Label className="text-sm text-muted-foreground">
                  Decimal Separator
                </Label>
                <Select
                  value={decimalSeparator}
                  onValueChange={setDecimalSeparator}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=".">Dot (.)</SelectItem>
                    <SelectItem value=",">Comma (,)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm text-muted-foreground">Header</Label>
                <Select value={headerType} onValueChange={setHeaderType}>
                  <SelectTrigger className="mt-1">
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

          {/* File Path Configuration */}
          <div className="border-t pt-4">
            <Label className="text-base font-medium">
              File Paths (Optional)
            </Label>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Leave empty for auto-detection based on naming patterns
            </p>

            <div className="space-y-4">
              {/* Training Data */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-muted-foreground">
                    Train X (Features)
                  </Label>
                  <Input
                    value={trainXPath}
                    onChange={(e) => setTrainXPath(e.target.value)}
                    placeholder="e.g., Xcal.csv"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">
                    Train Y (Targets)
                  </Label>
                  <Input
                    value={trainYPath}
                    onChange={(e) => setTrainYPath(e.target.value)}
                    placeholder="e.g., Ycal.csv"
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Test Data */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-muted-foreground">
                    Test X (Features)
                  </Label>
                  <Input
                    value={testXPath}
                    onChange={(e) => setTestXPath(e.target.value)}
                    placeholder="e.g., Xval.csv"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">
                    Test Y (Targets)
                  </Label>
                  <Input
                    value={testYPath}
                    onChange={(e) => setTestYPath(e.target.value)}
                    placeholder="e.g., Yval.csv"
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Group/Metadata Data */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-muted-foreground">
                    Train Groups (Metadata)
                  </Label>
                  <Input
                    value={trainGroupPath}
                    onChange={(e) => setTrainGroupPath(e.target.value)}
                    placeholder="e.g., Gcal.csv"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">
                    Test Groups (Metadata)
                  </Label>
                  <Input
                    value={testGroupPath}
                    onChange={(e) => setTestGroupPath(e.target.value)}
                    placeholder="e.g., Gval.csv"
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-muted/50 rounded-lg flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
              <p className="text-sm text-muted-foreground">
                Paths can be relative to the dataset folder or absolute paths.
                Common patterns like X_train, Y_cal, etc. are auto-detected.
              </p>
            </div>
          </div>

          {/* Dataset Info */}
          {dataset.num_samples !== undefined && (
            <div className="border-t pt-4">
              <Label className="text-base font-medium">Dataset Info</Label>
              <div className="grid grid-cols-3 gap-4 mt-3">
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">Samples</p>
                  <p className="text-lg font-semibold">
                    {dataset.num_samples?.toLocaleString() ?? "--"}
                  </p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">Features</p>
                  <p className="text-lg font-semibold">
                    {dataset.num_features?.toLocaleString() ?? "--"}
                  </p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-sm text-muted-foreground">Task</p>
                  <p className="text-lg font-semibold capitalize">
                    {dataset.task_type ?? "--"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
