import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SliderParamProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  tooltip?: string;
  precision?: number;
}

export function SliderParam({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  tooltip,
  precision = 3,
}: SliderParamProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Label className="text-xs">{label}</Label>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger>
                <span className="text-muted-foreground text-[10px]">(?)</span>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[250px] text-xs">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          {value.toFixed(precision)}
          {unit && ` ${unit}`}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="w-full"
      />
    </div>
  );
}
