/**
 * Gear-icon popover hosting the prediction-chart configuration.
 *
 * Sections shown depend on the currently active ChartKind:
 *  - Global: always
 *  - Scatter / Residuals: regression kinds
 *  - Confusion: classification kind
 */

import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listPalettes } from "./palettes";
import type {
  ChartConfig,
  ChartKind,
  ConfusionColorScale,
  ConfusionNormalize,
  ExportTheme,
  PaletteId,
} from "./types";

interface ChartConfigPopoverProps {
  kind: ChartKind;
  config: ChartConfig;
  onChange: (next: ChartConfig | ((prev: ChartConfig) => ChartConfig)) => void;
  onReset: () => void;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3">{children}</div>;
}

export function ChartConfigPopover({
  kind,
  config,
  onChange,
  onReset,
}: ChartConfigPopoverProps) {
  const update = <K extends keyof ChartConfig>(key: K, value: ChartConfig[K]) => {
    onChange((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Settings2 className="h-3.5 w-3.5" />
          <span className="text-xs">Configure</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Chart settings</div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onReset}>
            Reset
          </Button>
        </div>

        <div className="space-y-3">
          <SectionHeader>Global</SectionHeader>
          <Row>
            <Label className="text-xs">Palette</Label>
            <Select
              value={config.palette}
              onValueChange={(value) => update("palette", value as PaletteId)}
            >
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {listPalettes().map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row>
            <Label className="text-xs">Partition coloring</Label>
            <Switch
              checked={config.partitionColoring}
              onCheckedChange={(v) => update("partitionColoring", v)}
            />
          </Row>
          <Row>
            <Label className="text-xs">PNG export theme</Label>
            <Select
              value={config.exportTheme}
              onValueChange={(value) => update("exportTheme", value as ExportTheme)}
            >
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit" className="text-xs">Inherit</SelectItem>
                <SelectItem value="light" className="text-xs">Light</SelectItem>
                <SelectItem value="dark" className="text-xs">Dark</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row>
            <Label className="text-xs">Rescale axes to visible</Label>
            <Switch
              checked={config.rescaleToVisible}
              onCheckedChange={(v) => update("rescaleToVisible", v)}
            />
          </Row>
        </div>

        {(kind === "scatter" || kind === "residuals") && (
          <div className="space-y-3 border-t pt-3">
            <SectionHeader>Points</SectionHeader>
            <div className="space-y-1.5">
              <Row>
                <Label className="text-xs">Size</Label>
                <span className="text-xs text-muted-foreground">{config.pointSize}px</span>
              </Row>
              <Slider
                min={2}
                max={10}
                step={1}
                value={[config.pointSize]}
                onValueChange={(vals) => update("pointSize", vals[0] ?? 4)}
              />
            </div>
            <div className="space-y-1.5">
              <Row>
                <Label className="text-xs">Opacity</Label>
                <span className="text-xs text-muted-foreground">
                  {config.pointOpacity.toFixed(2)}
                </span>
              </Row>
              <Slider
                min={0.3}
                max={1}
                step={0.05}
                value={[config.pointOpacity]}
                onValueChange={(vals) => update("pointOpacity", vals[0] ?? 0.7)}
              />
            </div>
            <Row>
              <Label className="text-xs">Jitter discrete values</Label>
              <Switch
                checked={config.jitter}
                onCheckedChange={(v) => update("jitter", v)}
              />
            </Row>
          </div>
        )}

        {kind === "scatter" && (
          <div className="space-y-3 border-t pt-3">
            <SectionHeader>Scatter</SectionHeader>
            <Row>
              <Label className="text-xs">Identity line (y=x)</Label>
              <Switch
                checked={config.identityLine}
                onCheckedChange={(v) => update("identityLine", v)}
              />
            </Row>
            <Row>
              <Label className="text-xs">Regression line</Label>
              <Switch
                checked={config.regressionLine}
                onCheckedChange={(v) => update("regressionLine", v)}
              />
            </Row>
          </div>
        )}

        {kind === "residuals" && (
          <div className="space-y-3 border-t pt-3">
            <SectionHeader>Residuals</SectionHeader>
            <Row>
              <Label className="text-xs">Zero line</Label>
              <Switch
                checked={config.zeroLine}
                onCheckedChange={(v) => update("zeroLine", v)}
              />
            </Row>
            <Row>
              <Label className="text-xs">Reference band (±1σ)</Label>
              <Switch
                checked={config.sigmaBand}
                onCheckedChange={(v) => update("sigmaBand", v)}
              />
            </Row>
          </div>
        )}

        {kind === "confusion" && (
          <div className="space-y-3 border-t pt-3">
            <SectionHeader>Confusion matrix</SectionHeader>
            <Row>
              <Label className="text-xs">Normalization</Label>
              <Select
                value={config.confusionNormalize}
                onValueChange={(value) => update("confusionNormalize", value as ConfusionNormalize)}
              >
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">Counts</SelectItem>
                  <SelectItem value="row" className="text-xs">Row %</SelectItem>
                  <SelectItem value="col" className="text-xs">Column %</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row>
              <Label className="text-xs">Color scale</Label>
              <Select
                value={config.confusionColorScale}
                onValueChange={(value) => update("confusionColorScale", value as ConfusionColorScale)}
              >
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blue" className="text-xs">Sequential blue</SelectItem>
                  <SelectItem value="teal" className="text-xs">Sequential teal</SelectItem>
                  <SelectItem value="diverging" className="text-xs">Diverging</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row>
              <Label className="text-xs">Show row/col totals</Label>
              <Switch
                checked={config.confusionShowTotals}
                onCheckedChange={(v) => update("confusionShowTotals", v)}
              />
            </Row>
            <Row>
              <Label className="text-xs">Show count + %</Label>
              <Switch
                checked={config.confusionShowPercent}
                onCheckedChange={(v) => update("confusionShowPercent", v)}
              />
            </Row>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
