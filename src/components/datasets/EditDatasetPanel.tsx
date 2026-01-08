/**
 * EditDatasetPanel - Simplified dataset editor panel
 *
 * Replaces EditDatasetModal with a focused editing experience:
 * - Name & Description editing
 * - Content properties (task type, signal type, default target)
 * - Version management (refresh, verify)
 */
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  FolderOpen,
  RefreshCw,
  ShieldCheck,
  Copy,
  Check,
  AlertCircle,
} from "lucide-react";
import type { Dataset } from "@/types/datasets";
import type { UpdateDatasetRequest } from "@/api/client";

interface EditDatasetPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: Dataset | null;
  onSave: (datasetId: string, updates: UpdateDatasetRequest) => Promise<void>;
  onRefresh?: (datasetId: string) => Promise<void>;
  onVerify?: (datasetId: string) => Promise<void>;
}

/**
 * Get relative time string from ISO date
 */
function getRelativeTime(dateString: string | undefined): string {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export function EditDatasetPanel({
  open,
  onOpenChange,
  dataset,
  onSave,
  onRefresh,
  onVerify,
}: EditDatasetPanelProps) {
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [hashCopied, setHashCopied] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState<string>("auto");
  const [signalType, setSignalType] = useState<string>("auto");
  const [defaultTarget, setDefaultTarget] = useState<string>("");

  // Load existing values when dataset changes
  useEffect(() => {
    if (dataset) {
      setName(dataset.name || "");
      setDescription(dataset.description || "");
      setTaskType(dataset.task_type || "auto");
      setSignalType(dataset.signal_types?.[0] || "auto");
      setDefaultTarget(dataset.default_target || "");
    } else {
      // Reset to defaults
      setName("");
      setDescription("");
      setTaskType("auto");
      setSignalType("auto");
      setDefaultTarget("");
    }
  }, [dataset]);

  const handleSave = async () => {
    if (!dataset) return;

    setSaving(true);
    try {
      // Build update payload with changed fields
      const updates: UpdateDatasetRequest = {};

      if (name && name !== dataset.name) {
        updates.name = name;
      }
      if (description !== (dataset.description || "")) {
        updates.description = description;
      }
      if (defaultTarget !== (dataset.default_target || "")) {
        updates.default_target = defaultTarget || undefined;
      }

      if (Object.keys(updates).length > 0) {
        await onSave(dataset.id, updates);
      }
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save dataset config:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    if (!dataset || !onRefresh) return;

    setRefreshing(true);
    try {
      await onRefresh(dataset.id);
    } catch (error) {
      console.error("Failed to refresh dataset:", error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleVerify = async () => {
    if (!dataset || !onVerify) return;

    setVerifying(true);
    try {
      await onVerify(dataset.id);
    } catch (error) {
      console.error("Failed to verify dataset:", error);
    } finally {
      setVerifying(false);
    }
  };

  const copyHash = () => {
    if (dataset?.hash) {
      navigator.clipboard.writeText(dataset.hash);
      setHashCopied(true);
      setTimeout(() => setHashCopied(false), 2000);
    }
  };

  if (!dataset) return null;

  const versionStatus = dataset.version_status || "unchecked";
  const statusColors: Record<string, string> = {
    current: "bg-green-500/10 text-green-600 border-green-500/30",
    modified: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    missing: "bg-red-500/10 text-red-600 border-red-500/30",
    unchecked: "bg-gray-500/10 text-gray-600 border-gray-500/30",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Dataset</DialogTitle>
          <DialogDescription>
            Configure dataset properties and manage versioning
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Section: Basic Info */}
          <div className="space-y-4">
            <Label className="text-base font-medium">Basic Information</Label>
            <div className="space-y-3">
              <div>
                <Label className="text-sm text-muted-foreground">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dataset name"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">
                  Description (optional)
                </Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of this dataset..."
                  className="mt-1 min-h-[80px]"
                />
              </div>
            </div>
          </div>

          {/* Section: Properties */}
          <div className="space-y-4 border-t pt-4">
            <Label className="text-base font-medium">Properties</Label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm text-muted-foreground">Task Type</Label>
                <Select value={taskType} onValueChange={setTaskType}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select task type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="regression">Regression</SelectItem>
                    <SelectItem value="classification">Classification</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Signal Type</Label>
                <Select value={signalType} onValueChange={setSignalType}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select signal type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="nir">NIR</SelectItem>
                    <SelectItem value="mir">MIR</SelectItem>
                    <SelectItem value="raman">Raman</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Default Target */}
            {dataset.targets && dataset.targets.length > 0 && (
              <div>
                <Label className="text-sm text-muted-foreground">Default Target</Label>
                <Select value={defaultTarget} onValueChange={setDefaultTarget}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select default target" />
                  </SelectTrigger>
                  <SelectContent>
                    {dataset.targets.map((target) => (
                      <SelectItem key={target.column} value={target.column}>
                        {target.column}
                        {target.unit && ` (${target.unit})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Section: Version & Data */}
          <div className="space-y-4 border-t pt-4">
            <Label className="text-base font-medium">Version & Data</Label>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant="outline" className={statusColors[versionStatus]}>
                  {versionStatus === "current" && "Current"}
                  {versionStatus === "modified" && "Modified"}
                  {versionStatus === "missing" && "Missing"}
                  {versionStatus === "unchecked" && "Unchecked"}
                </Badge>
              </div>

              {dataset.version && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Version</span>
                  <span className="font-mono text-sm">{dataset.version}</span>
                </div>
              )}

              {dataset.hash && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Hash</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">
                      {dataset.hash.slice(0, 12)}...
                    </span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyHash}>
                      {hashCopied ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last Verified</span>
                <span className="text-sm">{getRelativeTime(dataset.last_verified)}</span>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                {onRefresh && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="flex-1"
                  >
                    {refreshing ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Refresh Data
                  </Button>
                )}
                {onVerify && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleVerify}
                    disabled={verifying}
                    className="flex-1"
                  >
                    {verifying ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 mr-2" />
                    )}
                    Verify Integrity
                  </Button>
                )}
              </div>

              {versionStatus === "modified" && (
                <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/30">
                  <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-600">Dataset has been modified</p>
                    <p className="text-muted-foreground">
                      Click "Refresh Data" to rescan the folder and include new samples.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section: Files */}
          {dataset.config && (
            <div className="space-y-4 border-t pt-4">
              <Label className="text-base font-medium">Files</Label>
              <div className="space-y-2 text-sm">
                {dataset.config.train_x && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Train X</span>
                    <span className="font-mono text-xs truncate max-w-[250px]" title={dataset.config.train_x}>
                      {dataset.config.train_x}
                    </span>
                  </div>
                )}
                {dataset.config.train_y && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Train Y</span>
                    <span className="font-mono text-xs truncate max-w-[250px]" title={dataset.config.train_y}>
                      {dataset.config.train_y}
                    </span>
                  </div>
                )}
                {dataset.config.test_x && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Test X</span>
                    <span className="font-mono text-xs truncate max-w-[250px]" title={dataset.config.test_x}>
                      {dataset.config.test_x}
                    </span>
                  </div>
                )}
                {dataset.config.test_y && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Test Y</span>
                    <span className="font-mono text-xs truncate max-w-[250px]" title={dataset.config.test_y}>
                      {dataset.config.test_y}
                    </span>
                  </div>
                )}
                {dataset.config.delimiter && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Delimiter</span>
                    <code className="text-xs bg-muted px-2 py-0.5 rounded">
                      {dataset.config.delimiter === ";" ? "semicolon" :
                       dataset.config.delimiter === "," ? "comma" :
                       dataset.config.delimiter === "\t" ? "tab" :
                       dataset.config.delimiter}
                    </code>
                  </div>
                )}
                {dataset.config.decimal_separator && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Decimal</span>
                    <code className="text-xs bg-muted px-2 py-0.5 rounded">
                      {dataset.config.decimal_separator}
                    </code>
                  </div>
                )}
                {!dataset.config.train_x && !dataset.config.test_x && (
                  <p className="text-muted-foreground">
                    Files are auto-detected from folder structure
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Section: Path */}
          <div className="space-y-4 border-t pt-4">
            <Label className="text-base font-medium">Location</Label>
            <div className="flex items-center gap-2">
              <Input
                value={dataset.path}
                readOnly
                className="flex-1 bg-muted/50 font-mono text-xs"
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
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
