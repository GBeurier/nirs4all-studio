/**
 * Step 3: Parsing Configuration
 *
 * Configure CSV/file parsing options:
 * - Global settings (delimiter, decimal, header, etc.)
 * - Per-file overrides
 * - Signal type and NA policy
 */
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Settings2,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Wand2,
  SlidersHorizontal,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useWizard, DEFAULT_PARSING } from "./WizardContext";
import { detectFormat, autoDetectFile } from "@/api/client";
import type { ParsingOptions, HeaderUnit, SignalType, NaPolicy, DetectionConfidence } from "@/types/datasets";

// Confidence indicator component
function ConfidenceIndicator({ value, field }: { value?: number; field: string }) {
  if (value === undefined || value === null) return null;

  const getColor = () => {
    if (value >= 0.8) return "text-green-600 dark:text-green-400";
    if (value >= 0.6) return "text-amber-500 dark:text-amber-400";
    return "text-red-500 dark:text-red-400";
  };

  const getIcon = () => {
    if (value >= 0.8) return "✓";
    if (value >= 0.6) return "~";
    return "!";
  };

  const pct = Math.round(value * 100);

  return (
    <span
      className={`text-xs ml-1 ${getColor()}`}
      title={`${field} detected with ${pct}% confidence`}
    >
      {getIcon()} {pct}%
    </span>
  );
}

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
  { value: "keep", label: "Keep NA values" },
  { value: "drop", label: "Drop rows with NA" },
  { value: "fill_mean", label: "Fill with mean" },
  { value: "fill_median", label: "Fill with median" },
  { value: "fill_zero", label: "Fill with zero" },
  { value: "error", label: "Error on NA" },
];

const ENCODING_OPTIONS = [
  { value: "utf-8", label: "UTF-8 (default)" },
  { value: "latin-1", label: "Latin-1 (ISO-8859-1)" },
  { value: "cp1252", label: "Windows-1252" },
  { value: "iso-8859-1", label: "ISO-8859-1" },
];

// Parsing options form component
interface ParsingFormProps {
  options: Partial<ParsingOptions>;
  onChange: (updates: Partial<ParsingOptions>) => void;
  compact?: boolean;
  confidence?: DetectionConfidence;
}

function ParsingForm({ options, onChange, compact = false, confidence }: ParsingFormProps) {
  const gridClass = compact
    ? "grid grid-cols-2 gap-3"
    : "grid grid-cols-3 gap-4";

  return (
    <div className={gridClass}>
      {/* Delimiter */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">
          Delimiter
          <ConfidenceIndicator value={confidence?.delimiter} field="Delimiter" />
        </Label>
        <Select
          value={options.delimiter || DEFAULT_PARSING.delimiter}
          onValueChange={(v) => onChange({ delimiter: v })}
        >
          <SelectTrigger className={compact ? "h-8 text-xs" : "h-9"}>
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
        <Label className="text-xs text-muted-foreground mb-1 block">
          Decimal
          <ConfidenceIndicator value={confidence?.decimal_separator} field="Decimal" />
        </Label>
        <Select
          value={options.decimal_separator || DEFAULT_PARSING.decimal_separator}
          onValueChange={(v) => onChange({ decimal_separator: v })}
        >
          <SelectTrigger className={compact ? "h-8 text-xs" : "h-9"}>
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
        <Label className="text-xs text-muted-foreground mb-1 block">
          Header Row
          <ConfidenceIndicator value={confidence?.has_header} field="Header" />
        </Label>
        <div className="flex items-center gap-2 h-9">
          <Switch
            checked={options.has_header ?? DEFAULT_PARSING.has_header}
            onCheckedChange={(v) => onChange({ has_header: v })}
          />
          <span className="text-sm">
            {options.has_header ?? DEFAULT_PARSING.has_header ? "Yes" : "No"}
          </span>
        </div>
      </div>

      {/* Header unit */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">
          Header Unit
          <ConfidenceIndicator value={confidence?.header_unit} field="Header unit" />
        </Label>
        <Select
          value={options.header_unit || DEFAULT_PARSING.header_unit}
          onValueChange={(v) => onChange({ header_unit: v as HeaderUnit })}
        >
          <SelectTrigger className={compact ? "h-8 text-xs" : "h-9"}>
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
        <Label className="text-xs text-muted-foreground mb-1 block">
          Signal Type
          <ConfidenceIndicator value={confidence?.signal_type} field="Signal type" />
        </Label>
        <Select
          value={options.signal_type || DEFAULT_PARSING.signal_type}
          onValueChange={(v) => onChange({ signal_type: v as SignalType })}
        >
          <SelectTrigger className={compact ? "h-8 text-xs" : "h-9"}>
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
        <Label className="text-xs text-muted-foreground mb-1 block">
          NA Handling
        </Label>
        <Select
          value={options.na_policy || DEFAULT_PARSING.na_policy}
          onValueChange={(v) => onChange({ na_policy: v as NaPolicy })}
        >
          <SelectTrigger className={compact ? "h-8 text-xs" : "h-9"}>
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
  );
}

// Per-file override row
interface FileOverrideRowProps {
  filename: string;
  path: string;
  hasOverride: boolean;
  overrides: Partial<ParsingOptions>;
  onToggle: () => void;
  onChange: (updates: Partial<ParsingOptions>) => void;
  onAutoDetect?: () => Promise<void>;
  shape?: { rows: number; cols: number };
  isDetecting?: boolean;
}

function FileOverrideRow({
  filename,
  path,
  hasOverride,
  overrides,
  onToggle,
  onChange,
  onAutoDetect,
  shape,
  isDetecting,
}: FileOverrideRowProps) {
  const [expanded, setExpanded] = useState(false);

  // Auto-expand when override is enabled
  const handleToggle = () => {
    if (!hasOverride) {
      // Enabling override - expand the row
      setExpanded(true);
    }
    onToggle();
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="border-b last:border-0">
        <div className="flex items-center gap-3 p-3 hover:bg-muted/30">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </Button>
          </CollapsibleTrigger>

          <span className="text-sm flex-1 truncate" title={path}>
            {filename}
          </span>

          {shape && (
            <Badge variant="outline" className="text-xs font-mono">
              {shape.rows} x {shape.cols}
            </Badge>
          )}

          {hasOverride && (
            <Badge variant="secondary" className="text-xs">
              Custom
            </Badge>
          )}

          <Switch
            checked={hasOverride}
            onCheckedChange={handleToggle}
            className="ml-2"
          />
        </div>

        <CollapsibleContent>
          {hasOverride && (
            <div className="px-3 pb-3 pt-1 ml-9 bg-muted/20 rounded-b-md space-y-2">
              {onAutoDetect && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onAutoDetect}
                    disabled={isDetecting}
                    className="h-7 text-xs"
                  >
                    {isDetecting ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Wand2 className="h-3 w-3 mr-1" />
                    )}
                    Auto-detect
                  </Button>
                </div>
              )}
              <ParsingForm options={overrides} onChange={onChange} compact />
            </div>
          )}
          {!hasOverride && expanded && (
            <div className="px-3 pb-3 pt-1 ml-9 text-sm text-muted-foreground">
              Using global settings. Enable override to customize.
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// Simple client-side delimiter detection for web mode
function detectDelimiterFromContent(content: string): { delimiter: string; decimal: string } {
  const lines = content.split("\n").slice(0, 10).filter(line => line.trim());
  if (lines.length === 0) return { delimiter: ";", decimal: "." };

  // Count occurrences of common delimiters
  const delimiters = [";", ",", "\t", "|"];
  const counts: Record<string, number[]> = {};

  for (const delim of delimiters) {
    counts[delim] = lines.map(line => (line.match(new RegExp(`\\${delim}`, "g")) || []).length);
  }

  // Find delimiter with most consistent count across lines
  let bestDelim = ";";
  let bestScore = 0;
  for (const [delim, lineCounts] of Object.entries(counts)) {
    const avg = lineCounts.reduce((a, b) => a + b, 0) / lineCounts.length;
    const variance = lineCounts.reduce((sum, c) => sum + Math.pow(c - avg, 2), 0) / lineCounts.length;
    const score = avg > 0 ? avg / (1 + variance) : 0;
    if (score > bestScore) {
      bestScore = score;
      bestDelim = delim;
    }
  }

  // Detect decimal separator from numeric values
  const numericPattern = /\d+[.,]\d+/g;
  let dotCount = 0;
  let commaCount = 0;
  for (const line of lines) {
    const matches = line.match(numericPattern) || [];
    for (const m of matches) {
      if (m.includes(".")) dotCount++;
      if (m.includes(",") && bestDelim !== ",") commaCount++;
    }
  }

  return {
    delimiter: bestDelim,
    decimal: commaCount > dotCount ? "," : ".",
  };
}

export function ParsingStep() {
  const { state, dispatch } = useWizard();
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [detectingFiles, setDetectingFiles] = useState<Record<string, boolean>>({});
  const hasAutoDetectedOnMount = useRef(false);

  // Check if we're in web mode (no filesystem access, files are in fileBlobs)
  const isWebMode = !state.basePath && state.fileBlobs.size > 0;

  const handleAutoDetect = useCallback(async () => {
    if (state.files.length === 0) return;

    setAutoDetecting(true);
    try {
      const firstXFile = state.files.find((f) => f.type === "X");
      if (!firstXFile) {
        setAutoDetecting(false);
        return;
      }

      // In web mode, do simple client-side detection from file content
      if (isWebMode) {
        const fileBlob = state.fileBlobs.get(firstXFile.path);
        if (fileBlob) {
          try {
            const content = await fileBlob.text();
            const detected = detectDelimiterFromContent(content);
            dispatch({
              type: "SET_PARSING",
              payload: {
                delimiter: detected.delimiter,
                decimal_separator: detected.decimal,
              },
            });
          } catch (e) {
            console.warn("Client-side detection failed:", e);
          }
        }
        setAutoDetecting(false);
        return;
      }

      // Desktop mode: use backend API for full detection
      const result = await autoDetectFile(firstXFile.path, true);

      if (result.success) {
        // Update parsing options with all detected values
        dispatch({
          type: "SET_PARSING",
          payload: {
            delimiter: result.delimiter || DEFAULT_PARSING.delimiter,
            decimal_separator: result.decimal_separator || DEFAULT_PARSING.decimal_separator,
            has_header: result.has_header ?? DEFAULT_PARSING.has_header,
            header_unit: (result.header_unit as HeaderUnit) || DEFAULT_PARSING.header_unit,
            signal_type: (result.signal_type as SignalType) || DEFAULT_PARSING.signal_type,
            encoding: result.encoding || "utf-8",
          },
        });

        // Update confidence scores in state
        dispatch({
          type: "SET_DETECTION_RESULTS",
          payload: {
            confidence: result.confidence,
          },
        });
      }
    } catch (error) {
      console.error("Auto-detect failed:", error);
      // Fallback to old detectFormat API
      try {
        const firstXFile = state.files.find((f) => f.type === "X");
        if (firstXFile && !isWebMode) {
          const result = await detectFormat({
            path: firstXFile.path,
            sample_rows: 10,
          });

          if (result) {
            dispatch({
              type: "SET_PARSING",
              payload: {
                delimiter: result.detected_delimiter || DEFAULT_PARSING.delimiter,
                decimal_separator: result.detected_decimal || DEFAULT_PARSING.decimal_separator,
                has_header: result.has_header ?? DEFAULT_PARSING.has_header,
              },
            });
          }
        }
      } catch (fallbackError) {
        console.error("Fallback auto-detect also failed:", fallbackError);
      }
    } finally {
      setAutoDetecting(false);
    }
  }, [state.files, state.fileBlobs, isWebMode, dispatch]);

  // Auto-detect on mount (first time only)
  useEffect(() => {
    if (!hasAutoDetectedOnMount.current && state.files.length > 0) {
      hasAutoDetectedOnMount.current = true;
      handleAutoDetect();
    }
  }, [state.files.length, handleAutoDetect]);

  // Per-file auto-detect for parsing options using nirs4all's AutoDetector
  const handlePerFileAutoDetect = useCallback(async (path: string) => {
    setDetectingFiles((prev) => ({ ...prev, [path]: true }));
    try {
      // In web mode, do client-side detection
      if (isWebMode) {
        const fileBlob = state.fileBlobs.get(path);
        if (fileBlob) {
          try {
            const content = await fileBlob.text();
            const detected = detectDelimiterFromContent(content);
            dispatch({
              type: "SET_FILE_OVERRIDE",
              payload: {
                path,
                options: {
                  delimiter: detected.delimiter,
                  decimal_separator: detected.decimal,
                },
              },
            });
          } catch (e) {
            console.warn("Client-side per-file detection failed:", e);
          }
        }
        return;
      }

      // Desktop mode: use backend API
      const result = await autoDetectFile(path, true);

      if (result.success) {
        dispatch({
          type: "SET_FILE_OVERRIDE",
          payload: {
            path,
            options: {
              delimiter: result.delimiter || DEFAULT_PARSING.delimiter,
              decimal_separator: result.decimal_separator || DEFAULT_PARSING.decimal_separator,
              has_header: result.has_header ?? DEFAULT_PARSING.has_header,
              header_unit: (result.header_unit as HeaderUnit) || DEFAULT_PARSING.header_unit,
              signal_type: (result.signal_type as SignalType) || DEFAULT_PARSING.signal_type,
              encoding: result.encoding || "utf-8",
            },
          },
        });
      }
    } catch (error) {
      console.error("Per-file auto-detect failed:", error);
      // Fallback to old detectFormat API (desktop mode only)
      if (!isWebMode) {
        try {
          const fallbackResult = await detectFormat({ path, sample_rows: 10 });
          if (fallbackResult) {
            dispatch({
              type: "SET_FILE_OVERRIDE",
              payload: {
                path,
                options: {
                  delimiter: fallbackResult.detected_delimiter || DEFAULT_PARSING.delimiter,
                  decimal_separator: fallbackResult.detected_decimal || DEFAULT_PARSING.decimal_separator,
                  has_header: fallbackResult.has_header ?? DEFAULT_PARSING.has_header,
                },
              },
            });
          }
        } catch (fallbackError) {
          console.error("Fallback per-file auto-detect also failed:", fallbackError);
        }
      }
    } finally {
      setDetectingFiles((prev) => ({ ...prev, [path]: false }));
    }
  }, [dispatch, isWebMode, state.fileBlobs]);

  const handleResetDefaults = () => {
    dispatch({ type: "SET_PARSING", payload: { ...DEFAULT_PARSING } });
  };

  const handleFileOverrideToggle = (path: string) => {
    if (state.perFileOverrides[path]) {
      // Remove override
      dispatch({
        type: "SET_FILE_OVERRIDE",
        payload: { path, options: null },
      });
    } else {
      // Add empty override
      dispatch({
        type: "SET_FILE_OVERRIDE",
        payload: { path, options: {} },
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-4 py-2">
      {/* Global settings */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <Label className="text-base font-medium">Global Settings</Label>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAutoDetect}
              disabled={autoDetecting || state.files.length === 0}
            >
              <Wand2 className="h-4 w-4 mr-1" />
              {autoDetecting ? "Detecting..." : "Auto-detect"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleResetDefaults}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
          </div>
        </div>

        <ParsingForm
          options={state.parsing}
          onChange={(updates) =>
            dispatch({ type: "SET_PARSING", payload: updates })
          }
          confidence={state.confidence}
        />

        {/* Advanced Loading Options Accordion */}
        <Accordion type="single" collapsible className="mt-4">
          <AccordionItem value="advanced-loading" className="border-none">
            <AccordionTrigger className="py-2 hover:no-underline">
              <div className="flex items-center gap-2 text-sm">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                <span>Advanced Loading Options</span>
                <Badge variant="outline" className="ml-2 text-xs font-normal">
                  Optional
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-3 gap-4 pt-2">
                {/* Encoding */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    File Encoding
                  </Label>
                  <Select
                    value={state.parsing.encoding || "utf-8"}
                    onValueChange={(v) =>
                      dispatch({ type: "SET_PARSING", payload: { encoding: v } })
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENCODING_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Skip Rows */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    Skip Rows at Start
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={state.parsing.skip_rows || 0}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_PARSING",
                        payload: { skip_rows: parseInt(e.target.value) || 0 },
                      })
                    }
                    className="h-9"
                  />
                </div>

                {/* Sheet Name (for Excel files) */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    Sheet Name (Excel)
                  </Label>
                  <Input
                    type="text"
                    placeholder="First sheet (default)"
                    value={state.parsing.sheet_name || ""}
                    onChange={(e) =>
                      dispatch({
                        type: "SET_PARSING",
                        payload: { sheet_name: e.target.value || undefined },
                      })
                    }
                    className="h-9"
                  />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      {/* Per-file overrides */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-base font-medium">Per-File Overrides</Label>
          <span className="text-xs text-muted-foreground">
            {Object.keys(state.perFileOverrides).length} customized
          </span>
        </div>

        <ScrollArea className="flex-1 border rounded-lg">
          {state.files.length > 0 ? (
            state.files.map((file) => (
              <FileOverrideRow
                key={file.path}
                filename={file.filename}
                path={file.path}
                hasOverride={!!state.perFileOverrides[file.path]}
                overrides={state.perFileOverrides[file.path] || {}}
                onToggle={() => handleFileOverrideToggle(file.path)}
                onChange={(updates) =>
                  dispatch({
                    type: "SET_FILE_OVERRIDE",
                    payload: { path: file.path, options: updates },
                  })
                }
                onAutoDetect={() => handlePerFileAutoDetect(file.path)}
                shape={file.num_rows != null && file.num_columns != null ? { rows: file.num_rows, cols: file.num_columns } : undefined}
                isDetecting={detectingFiles[file.path]}
              />
            ))
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No files to configure
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
