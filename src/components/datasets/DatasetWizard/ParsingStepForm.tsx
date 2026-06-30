/**
 * Parsing options form + confidence indicator.
 *
 * Pure presentation: renders the grid of delimiter / decimal / header / signal /
 * NA controls (plus the optional fill-config sub-form) and reports edits through
 * the `onChange` callback. Used both as the global settings form and, in compact
 * mode, inside per-file overrides.
 */
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
import { DEFAULT_PARSING } from "./useWizard";
import {
  DELIMITER_OPTIONS,
  DECIMAL_OPTIONS,
  HEADER_UNIT_OPTIONS,
  SIGNAL_TYPE_OPTIONS,
  NA_POLICY_OPTIONS,
  FILL_METHOD_OPTIONS,
} from "./ParsingStepConstants";
import type { ParsingOptions, HeaderUnit, SignalType, NaPolicy, NaFillConfig, DetectionConfidence } from "@/types/datasets";
import { useTranslation } from "react-i18next";

// Confidence indicator component
export function ConfidenceIndicator({ value, field }: { value?: number; field: string }) {
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

// Parsing options form component
export interface ParsingFormProps {
  options: Partial<ParsingOptions>;
  onChange: (updates: Partial<ParsingOptions>) => void;
  compact?: boolean;
  confidence?: DetectionConfidence;
}

export function ParsingForm({ options, onChange, compact = false, confidence }: ParsingFormProps) {
  const { t } = useTranslation();
  const gridClass = compact
    ? "grid grid-cols-2 gap-3"
    : "grid grid-cols-3 gap-4";

  const currentNaPolicy = options.na_policy || DEFAULT_PARSING.na_policy;

  return (
    <div className="space-y-4">
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
            value={currentNaPolicy}
            onValueChange={(v) => {
              const updates: Partial<ParsingOptions> = { na_policy: v as NaPolicy };
              // Clear fill config when switching away from replace
              if (v !== "replace") {
                updates.na_fill_config = undefined;
              }
              onChange(updates);
            }}
          >
            <SelectTrigger className={compact ? "h-8 text-xs" : "h-9"}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NA_POLICY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Fill config sub-form (visible when replace is selected) */}
      {currentNaPolicy === "replace" && (
        <div className="border rounded-md p-3 bg-muted/30 space-y-3">
          <Label className="text-xs font-medium block">
            {t("settings.dataDefaults.missing.fillConfig")}
          </Label>
          <div className={compact ? "grid grid-cols-2 gap-3" : "grid grid-cols-3 gap-4"}>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                {t("settings.dataDefaults.missing.fillMethod")}
              </Label>
              <Select
                value={options.na_fill_config?.method || "mean"}
                onValueChange={(v) =>
                  onChange({
                    na_fill_config: {
                      ...options.na_fill_config,
                      method: v as NaFillConfig["method"],
                    },
                  })
                }
              >
                <SelectTrigger className={compact ? "h-8 text-xs" : "h-9"}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FILL_METHOD_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {options.na_fill_config?.method === "value" && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  {t("settings.dataDefaults.missing.fillValue")}
                </Label>
                <Input
                  type="number"
                  value={options.na_fill_config?.fill_value ?? 0}
                  onChange={(e) =>
                    onChange({
                      na_fill_config: {
                        ...options.na_fill_config!,
                        fill_value: parseFloat(e.target.value) || 0,
                      },
                    })
                  }
                  className={compact ? "h-8 text-xs" : "h-9"}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
