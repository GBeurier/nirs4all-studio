/**
 * EditDatasetPanel - Dataset editor panel with parsing configuration
 *
 * Includes:
 * - Name & Description editing
 * - Parsing configuration (delimiter, decimal, header, signal type) with auto-detect
 * - Content properties (task type, signal type, default target)
 * - Version management (refresh, verify)
 */
import { useState, useEffect, useCallback } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Loader2,
  FolderOpen,
  RefreshCw,
  ShieldCheck,
  Copy,
  Check,
  AlertCircle,
  Wand2,
  ChevronDown,
  Settings2,
} from "lucide-react";
import type { Dataset, DatasetConfig, ParsingOptions, HeaderUnit, SignalType, NaPolicy } from "@/types/datasets";
import type { UpdateDatasetRequest } from "@/api/client";
import { autoDetectFile } from "@/api/client";

interface EditDatasetPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: Dataset | null;
  onSave: (datasetId: string, updates: UpdateDatasetRequest) => Promise<void>;
  onRefresh?: (datasetId: string) => Promise<void>;
  onVerify?: (datasetId: string) => Promise<void>;
}

// Default parsing options
const DEFAULT_PARSING: ParsingOptions = {
  delimiter: ";",
  decimal_separator: ".",
  has_header: true,
  header_unit: "cm-1",
  signal_type: "auto",
  na_policy: "auto",
};

// Options for selects
const DELIMITER_OPTIONS = [
  { value: ";", label: "Semicolon (;)" },
  { value: ",", label: "Comma (,)" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Pipe (|)" },
  { value: " ", label: "Space" },
];

const DECIMAL_OPTIONS = [
  { value: ".", label: "Dot (.)" },
  { value: ",", label: "Comma (,)" },
];

const HEADER_UNIT_OPTIONS: { value: HeaderUnit; label: string }[] = [
  { value: "nm", label: "Wavelength (nm)" },
  { value: "cm-1", label: "Wavenumber (cm⁻¹)" },
  { value: "text", label: "Text labels" },
  { value: "index", label: "Numeric index" },
  { value: "none", label: "No header" },
];

const SIGNAL_TYPE_OPTIONS: { value: SignalType; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "absorbance", label: "Absorbance" },
  { value: "reflectance", label: "Reflectance (0-1)" },
  { value: "reflectance%", label: "Reflectance (%)" },
  { value: "transmittance", label: "Transmittance (0-1)" },
  { value: "transmittance%", label: "Transmittance (%)" },
];

const NA_POLICY_OPTIONS: { value: NaPolicy; label: string }[] = [
  { value: "auto", label: "Auto (abort on NA)" },
  { value: "abort", label: "Abort on NA" },
  { value: "remove_sample", label: "Remove samples with NA" },
  { value: "remove_feature", label: "Remove features with NA" },
  { value: "replace", label: "Replace NA values" },
  { value: "ignore", label: "Ignore (handle in pipeline)" },
];

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
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [parsingExpanded, setParsingExpanded] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState<string>("auto");
  const [signalType, setSignalType] = useState<string>("auto");
  const [defaultTarget, setDefaultTarget] = useState<string>("");

  // Parsing state
  const [delimiter, setDelimiter] = useState<string>(DEFAULT_PARSING.delimiter);
  const [decimalSeparator, setDecimalSeparator] = useState<string>(DEFAULT_PARSING.decimal_separator);
  const [hasHeader, setHasHeader] = useState<boolean>(DEFAULT_PARSING.has_header);
  const [headerUnit, setHeaderUnit] = useState<HeaderUnit>(DEFAULT_PARSING.header_unit);
  const [parsingSignalType, setParsingSignalType] = useState<SignalType>(DEFAULT_PARSING.signal_type);
  const [naPolicy, setNaPolicy] = useState<NaPolicy>(DEFAULT_PARSING.na_policy);

  // Load existing values when dataset changes
  useEffect(() => {
    if (dataset) {
      setName(dataset.name || "");
      setDescription(dataset.description || "");
      setTaskType(dataset.task_type || "auto");
      setSignalType(dataset.signal_types?.[0] || "auto");
      setDefaultTarget(dataset.default_target || "");

      // Load parsing config
      const config = (dataset.config || {}) as Partial<DatasetConfig>;
      setDelimiter(config.delimiter || DEFAULT_PARSING.delimiter);
      setDecimalSeparator(config.decimal_separator || DEFAULT_PARSING.decimal_separator);
      setHasHeader(config.has_header ?? DEFAULT_PARSING.has_header);
      setHeaderUnit((config.header_unit || config.header_type || DEFAULT_PARSING.header_unit) as HeaderUnit);
      setParsingSignalType((config.signal_type || DEFAULT_PARSING.signal_type) as SignalType);
      setNaPolicy((config.na_policy || DEFAULT_PARSING.na_policy) as NaPolicy);
    } else {
      // Reset to defaults
      setName("");
      setDescription("");
      setTaskType("auto");
      setSignalType("auto");
      setDefaultTarget("");
      setDelimiter(DEFAULT_PARSING.delimiter);
      setDecimalSeparator(DEFAULT_PARSING.decimal_separator);
      setHasHeader(DEFAULT_PARSING.has_header);
      setHeaderUnit(DEFAULT_PARSING.header_unit);
      setParsingSignalType(DEFAULT_PARSING.signal_type);
      setNaPolicy(DEFAULT_PARSING.na_policy);
    }
  }, [dataset]);

  const handleAutoDetect = useCallback(async () => {
    if (!dataset?.path) return;

    setAutoDetecting(true);
    try {
      // Try to find an X file in the config or use the dataset path
      const xPath = dataset.config?.train_x || dataset.path;
      const result = await autoDetectFile(xPath, true);

      if (result.success) {
        setDelimiter(result.delimiter || DEFAULT_PARSING.delimiter);
        setDecimalSeparator(result.decimal_separator || DEFAULT_PARSING.decimal_separator);
        setHasHeader(result.has_header ?? DEFAULT_PARSING.has_header);
        if (result.header_unit) {
          setHeaderUnit(result.header_unit as HeaderUnit);
        }
        if (result.signal_type) {
          setParsingSignalType(result.signal_type as SignalType);
        }
      }
    } catch (error) {
      console.error("Auto-detect failed:", error);
    } finally {
      setAutoDetecting(false);
    }
  }, [dataset?.path, dataset?.config?.train_x]);

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

      // Build config with parsing options
      const newConfig: Partial<DatasetConfig> = {
        ...(dataset.config || {}),
        delimiter,
        decimal_separator: decimalSeparator,
        has_header: hasHeader,
        header_unit: headerUnit,
        signal_type: parsingSignalType,
        na_policy: naPolicy,
      };

      // Check if parsing config changed
      const oldConfig = (dataset.config || {}) as Partial<DatasetConfig>;
      const parsingChanged =
        delimiter !== (oldConfig.delimiter || DEFAULT_PARSING.delimiter) ||
        decimalSeparator !== (oldConfig.decimal_separator || DEFAULT_PARSING.decimal_separator) ||
        hasHeader !== (oldConfig.has_header ?? DEFAULT_PARSING.has_header) ||
        headerUnit !== (oldConfig.header_unit || oldConfig.header_type || DEFAULT_PARSING.header_unit) ||
        parsingSignalType !== (oldConfig.signal_type || DEFAULT_PARSING.signal_type) ||
        naPolicy !== (oldConfig.na_policy || DEFAULT_PARSING.na_policy);

      if (parsingChanged) {
        updates.config = newConfig;
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
            Configure dataset properties, parsing options, and manage versioning
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

          {/* Section: Parsing Configuration */}
          <Collapsible open={parsingExpanded} onOpenChange={setParsingExpanded}>
            <div className="space-y-4 border-t pt-4">
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between cursor-pointer hover:bg-muted/30 -mx-2 px-2 py-1 rounded">
                  <div className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-base font-medium cursor-pointer">Parsing Configuration</Label>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${parsingExpanded ? "rotate-180" : ""}`} />
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent className="space-y-4">
                {/* Auto-detect button */}
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAutoDetect}
                    disabled={autoDetecting}
                  >
                    {autoDetecting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4 mr-2" />
                    )}
                    Auto-detect
                  </Button>
                </div>

                {/* Parsing form */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Delimiter */}
                  <div>
                    <Label className="text-sm text-muted-foreground">Delimiter</Label>
                    <Select value={delimiter} onValueChange={setDelimiter}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DELIMITER_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Decimal separator */}
                  <div>
                    <Label className="text-sm text-muted-foreground">Decimal</Label>
                    <Select value={decimalSeparator} onValueChange={setDecimalSeparator}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DECIMAL_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Has header */}
                  <div>
                    <Label className="text-sm text-muted-foreground">Header Row</Label>
                    <div className="flex items-center gap-2 h-9 mt-1">
                      <Switch
                        checked={hasHeader}
                        onCheckedChange={setHasHeader}
                      />
                      <span className="text-sm">{hasHeader ? "Yes" : "No"}</span>
                    </div>
                  </div>

                  {/* Header unit */}
                  <div>
                    <Label className="text-sm text-muted-foreground">Header Unit</Label>
                    <Select value={headerUnit} onValueChange={(v) => setHeaderUnit(v as HeaderUnit)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HEADER_UNIT_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Signal type */}
                  <div>
                    <Label className="text-sm text-muted-foreground">Signal Type</Label>
                    <Select value={parsingSignalType} onValueChange={(v) => setParsingSignalType(v as SignalType)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SIGNAL_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* NA policy */}
                  <div>
                    <Label className="text-sm text-muted-foreground">NA Handling</Label>
                    <Select value={naPolicy} onValueChange={(v) => setNaPolicy(v as NaPolicy)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NA_POLICY_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

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
