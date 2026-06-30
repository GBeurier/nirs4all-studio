import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Row } from "./ChartConfigPopoverPrimitives";

interface SelectControlProps {
  value: string | undefined;
  onValueChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  placeholder?: string;
  triggerClassName?: string;
  triggerContent?: ReactNode;
}

function SelectControl({
  value,
  onValueChange,
  children,
  disabled,
  placeholder,
  triggerClassName = "h-8 w-40 text-xs",
  triggerContent,
}: SelectControlProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={triggerClassName}>
        {triggerContent ?? <SelectValue placeholder={placeholder} />}
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

interface SelectRowProps extends SelectControlProps {
  label: string;
}

export function SelectRow({ label, ...selectProps }: SelectRowProps) {
  return (
    <Row>
      <Label className="text-xs">{label}</Label>
      <SelectControl {...selectProps} />
    </Row>
  );
}

interface SelectFieldProps extends SelectControlProps {
  label: string;
  footer?: ReactNode;
}

export function SelectField({
  label,
  footer,
  triggerClassName = "h-9 w-full text-xs",
  ...selectProps
}: SelectFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <SelectControl triggerClassName={triggerClassName} {...selectProps} />
      {footer}
    </div>
  );
}

export function SliderField({
  label,
  valueLabel,
  value,
  min,
  max,
  step,
  fallback,
  onValueChange,
}: {
  label: string;
  valueLabel: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  fallback: number;
  onValueChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Row>
        <Label className="text-xs">{label}</Label>
        <span className="text-xs text-muted-foreground">{valueLabel}</span>
      </Row>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(vals) => onValueChange(vals[0] ?? fallback)}
      />
    </div>
  );
}

export function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Row>
      <Label className="text-xs">{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </Row>
  );
}
