/**
 * Step 3: Parsing Configuration
 *
 * Configure CSV/file parsing options:
 * - Global settings (delimiter, decimal, header, etc.)
 * - Per-file overrides
 * - Signal type and NA policy
 */
import { useState } from "react";
import {
  Settings2,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Wand2,
  SlidersHorizontal,
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
import { detectFormat } from "@/api/client";
import type { ParsingOptions, HeaderUnit, SignalType, NaPolicy } from "@/types/datasets";

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
}

function ParsingForm({ options, onChange, compact = false }: ParsingFormProps) {
  const gridClass = compact
    ? "grid grid-cols-2 gap-3"
    : "grid grid-cols-3 gap-4";

  return (
    <div className={gridClass}>
      {/* Delimiter */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">
          Delimiter
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

      {/* Skip rows */}
      {!compact && (
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">
            Skip Rows
          </Label>
          <Input
            type="number"
            min={0}
            value={options.skip_rows || 0}
            onChange={(e) =>
              onChange({ skip_rows: parseInt(e.target.value) || 0 })
            }
            className="h-9"
          />
        </div>
      )}
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
}

function FileOverrideRow({
  filename,
  path,
  hasOverride,
  overrides,
  onToggle,
  onChange,
}: FileOverrideRowProps) {
  const [expanded, setExpanded] = useState(false);

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

          {hasOverride && (
            <Badge variant="secondary" className="text-xs">
              Custom
            </Badge>
          )}

          <Switch
            checked={hasOverride}
            onCheckedChange={onToggle}
            className="ml-2"
          />
        </div>

        <CollapsibleContent>
          {hasOverride && (
            <div className="px-3 pb-3 pt-1 ml-9 bg-muted/20 rounded-b-md">
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

export function ParsingStep() {
  const { state, dispatch } = useWizard();
  const [autoDetecting, setAutoDetecting] = useState(false);

  const handleAutoDetect = async () => {
    if (state.files.length === 0) return;

    setAutoDetecting(true);
    try {
      // Try to detect format from first X file
      const firstXFile = state.files.find((f) => f.type === "X");
      if (firstXFile) {
        const result = await detectFormat({
          path: firstXFile.path,
          sample_rows: 10,
        });

        if (result) {
          dispatch({
            type: "SET_PARSING",
            payload: {
              delimiter: result.detected_delimiter || DEFAULT_PARSING.delimiter,
              decimal_separator:
                result.detected_decimal || DEFAULT_PARSING.decimal_separator,
              has_header: result.has_header ?? DEFAULT_PARSING.has_header,
            },
          });
        }
      }
    } catch (error) {
      console.error("Auto-detect failed:", error);
    } finally {
      setAutoDetecting(false);
    }
  };

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
