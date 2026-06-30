import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SweepConfigPopover } from "../SweepConfigPopover";
import type { ParameterSweep } from "../types";
import { selectOptions } from "./paramInputOptions";
import { useSelectWheel } from "./useSelectWheel";

interface ParamInputBaseProps {
  paramKey: string;
  info?: string;
  sweep?: ParameterSweep;
  hasSweepActive: boolean;
  onParamChange: (key: string, value: unknown) => void;
  onSweepChange: (key: string, sweep: ParameterSweep | undefined) => void;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

/**
 * Label with optional info tooltip and sweep indicator.
 */
function ParamLabel({
  paramKey,
  info,
  hasSweepActive,
}: {
  paramKey: string;
  info?: string;
  hasSweepActive: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label
        className={`text-sm capitalize ${hasSweepActive ? "text-orange-500" : ""}`}
      >
        {paramKey.replace(/_/g, " ")}
      </Label>
      {info && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[200px]">
            <p>{info}</p>
          </TooltipContent>
        </Tooltip>
      )}
      {hasSweepActive && (
        <Badge
          variant="outline"
          className="text-[10px] px-1 h-4 border-orange-500/50 text-orange-500"
        >
          sweep
        </Badge>
      )}
    </div>
  );
}

/**
 * Boolean parameter input (switch).
 */
export function BooleanParamInput({
  paramKey,
  value,
  info,
  sweep,
  hasSweepActive,
  onParamChange,
  onSweepChange,
}: ParamInputBaseProps & { value: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between py-2">
        <ParamLabel paramKey={paramKey} info={info} hasSweepActive={hasSweepActive} />
        <Switch
          checked={value}
          onCheckedChange={(checked) => onParamChange(paramKey, checked)}
          disabled={hasSweepActive}
        />
      </div>
      <SweepConfigPopover
        paramKey={paramKey}
        currentValue={value}
        sweep={sweep}
        onSweepChange={(s) => onSweepChange(paramKey, s)}
      />
    </div>
  );
}

/**
 * Select parameter input (dropdown).
 */
export function SelectParamInput({
  paramKey,
  value,
  info,
  sweep,
  hasSweepActive,
  onParamChange,
  onSweepChange,
}: ParamInputBaseProps & { value: string | number | boolean }) {
  const options = selectOptions[paramKey] || [];

  const handleWheel = useSelectWheel(
    String(value),
    (newValue) => onParamChange(paramKey, newValue),
    options.map((opt) => ({ value: opt.value })),
    !hasSweepActive && options.length > 0
  );

  return (
    <div className="space-y-2">
      <ParamLabel paramKey={paramKey} info={info} hasSweepActive={hasSweepActive} />
      <div onWheel={handleWheel}>
        <Select
          value={String(value)}
          onValueChange={(v) => onParamChange(paramKey, v)}
          disabled={hasSweepActive}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover">
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <SweepConfigPopover
        paramKey={paramKey}
        currentValue={value}
        sweep={sweep}
        onSweepChange={(s) => onSweepChange(paramKey, s)}
      />
    </div>
  );
}

/**
 * Text/Number parameter input.
 */
export function TextParamInput({
  paramKey,
  value,
  info,
  sweep,
  hasSweepActive,
  onParamChange,
  onSweepChange,
}: ParamInputBaseProps & { value: string | number | boolean }) {
  const isNumber = typeof value === "number";

  return (
    <div className="space-y-2">
      <ParamLabel paramKey={paramKey} info={info} hasSweepActive={hasSweepActive} />
      <Input
        type={isNumber ? "number" : "text"}
        value={value as string | number}
        onChange={(e) => {
          const newValue = isNumber
            ? parseFloat(e.target.value) || 0
            : e.target.value;
          onParamChange(paramKey, newValue);
        }}
        step={
          isNumber
            ? (value as number) < 1 && (value as number) > 0
              ? 0.01
              : 1
            : undefined
        }
        className="font-mono text-sm"
        disabled={hasSweepActive}
      />
      <SweepConfigPopover
        paramKey={paramKey}
        currentValue={value}
        sweep={sweep}
        onSweepChange={(s) => onSweepChange(paramKey, s)}
      />
    </div>
  );
}

export function StructuredParamInput({
  paramKey,
  value,
  info,
  onParamChange,
}: {
  paramKey: string;
  value: Record<string, unknown> | unknown[] | null;
  info?: string;
  onParamChange: (key: string, value: unknown) => void;
}) {
  const [draft, setDraft] = useState(() => safeJsonStringify(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(safeJsonStringify(value));
    setError(null);
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ParamLabel paramKey={paramKey} info={info} hasSweepActive={false} />
        <Badge variant="outline" className="text-[10px] px-1 h-4">
          JSON
        </Badge>
      </div>
      <Textarea
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          try {
            onParamChange(paramKey, JSON.parse(next));
            setError(null);
          } catch {
            setError("Invalid JSON");
          }
        }}
        className="min-h-28 font-mono text-xs"
        spellCheck={false}
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Structured params are preserved as canonical JSON.
        </p>
      )}
    </div>
  );
}
