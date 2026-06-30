/**
 * Small render-only building blocks shared across the chart-config popover
 * sections: section headers, label/control rows, palette swatches, and the
 * color-input row. These own no state and emit no config updates of their own.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getConfusionGradientCss } from "./palettes";
import type { ChartConfig, ViewerGradientColors } from "./types";

/** Setter passed down to sections; mirrors `ChartConfigPopover`'s `update`. */
export type ChartConfigUpdater = <K extends keyof ChartConfig>(key: K, value: ChartConfig[K]) => void;

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3">{children}</div>;
}

export function MiniDiscretePalette({ colors }: { colors: readonly string[] }) {
  return (
    <div className="flex items-center gap-0.5">
      {colors.map((color, index) => (
        <span
          key={`${color}-${index}`}
          aria-hidden
          className="h-3 w-3 rounded-sm border border-border/50"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

export function MiniGradientBar({ gradient }: { gradient: ViewerGradientColors }) {
  return (
    <span
      aria-hidden
      className="h-3 w-16 rounded-sm border border-border/50"
      style={{ backgroundImage: getConfusionGradientCss(gradient) }}
    />
  );
}

export function ColorInputRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-10 cursor-pointer overflow-hidden rounded-md border border-input bg-transparent p-1"
        />
        <div className="min-w-0 flex-1 rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground/80">
          {value}
        </div>
      </div>
    </div>
  );
}
