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
import { Input } from "@/components/ui/input";
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
import {
  getConfusionGradientColors,
  getConfusionGradientCss,
  getConfusionGradientLabel,
  getPaletteLabel,
  getPartitionPaletteColors,
  isConfusionGradientPresetId,
  isPartitionPalettePreset,
  listConfusionGradients,
  listPalettes,
  normalizeColorToHex,
} from "./palettes";
import type {
  ChartConfig,
  ChartKind,
  ConfusionNormalize,
  ExportTheme,
  ViewerGradientColors,
  ViewerPartitionColors,
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

function MiniDiscretePalette({ colors }: { colors: readonly string[] }) {
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

function MiniGradientBar({ gradient }: { gradient: ViewerGradientColors }) {
  return (
    <span
      aria-hidden
      className="h-3 w-16 rounded-sm border border-border/50"
      style={{ backgroundImage: getConfusionGradientCss(gradient) }}
    />
  );
}

function ColorInputRow({
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

export function ChartConfigPopover({
  kind,
  config,
  onChange,
  onReset,
}: ChartConfigPopoverProps) {
  const update = <K extends keyof ChartConfig>(key: K, value: ChartConfig[K]) => {
    onChange((prev) => ({ ...prev, [key]: value }));
  };

  const currentPaletteColors = [
    config.partitionColors.train,
    config.partitionColors.val,
    config.partitionColors.test,
  ] as const;

  const applyPartitionPalette = (value: string) => {
    if (!isPartitionPalettePreset(value)) {
      update("palette", "custom");
      return;
    }

    onChange((prev) => ({
      ...prev,
      palette: value,
      partitionColors: getPartitionPaletteColors(value),
    }));
  };

  const updatePartitionColor = (key: keyof ViewerPartitionColors, value: string) => {
    onChange((prev) => ({
      ...prev,
      palette: "custom",
      partitionColors: {
        ...prev.partitionColors,
        [key]: normalizeColorToHex(value, prev.partitionColors[key]),
      },
    }));
  };

  const applyConfusionGradientPreset = (value: string) => {
    if (!isConfusionGradientPresetId(value)) {
      update("confusionGradientPreset", "custom");
      return;
    }

    onChange((prev) => ({
      ...prev,
      confusionGradientPreset: value,
      confusionGradient: getConfusionGradientColors(value),
    }));
  };

  const updateConfusionGradient = (key: keyof ViewerGradientColors, value: string) => {
    onChange((prev) => ({
      ...prev,
      confusionGradientPreset: "custom",
      confusionGradient: {
        ...prev.confusionGradient,
        [key]: normalizeColorToHex(value, prev.confusionGradient[key]),
      },
    }));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Settings2 className="h-3.5 w-3.5" />
          <span className="text-xs">Configure</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[23rem] space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Chart settings</div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onReset}>
            Reset
          </Button>
        </div>

        <div className="space-y-3">
          <SectionHeader>Global</SectionHeader>
          {kind !== "confusion" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Partition palette</Label>
            <Select
              value={config.palette}
              onValueChange={applyPartitionPalette}
            >
              <SelectTrigger className="h-9 w-full text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <MiniDiscretePalette colors={currentPaletteColors} />
                  <span className="truncate">{getPaletteLabel(config.palette)}</span>
                </div>
              </SelectTrigger>
              <SelectContent>
                {listPalettes().map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    <div className="flex items-center gap-2">
                      <MiniDiscretePalette colors={p.colors} />
                      <span>{p.label}</span>
                    </div>
                  </SelectItem>
                ))}
                <SelectItem value="custom" className="text-xs">
                  <div className="flex items-center gap-2">
                    <MiniDiscretePalette colors={currentPaletteColors} />
                    <span>Custom</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] leading-4 text-muted-foreground">
              Uses the same discrete palette family as Playground classification targets. Choosing a preset updates the three editable colors below.
            </p>
          </div>
          )}
          {kind !== "confusion" && (
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <ColorInputRow
              label="Train"
              value={config.partitionColors.train}
              onChange={(value) => updatePartitionColor("train", value)}
            />
            <ColorInputRow
              label="Validation"
              value={config.partitionColors.val}
              onChange={(value) => updatePartitionColor("val", value)}
            />
            <ColorInputRow
              label="Test"
              value={config.partitionColors.test}
              onChange={(value) => updatePartitionColor("test", value)}
            />
          </div>
          )}
          {kind !== "confusion" && (
          <Row>
            <Label className="text-xs">Partition coloring</Label>
            <Switch
              checked={config.partitionColoring}
              onCheckedChange={(v) => update("partitionColoring", v)}
            />
          </Row>
          )}
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
            <div className="space-y-1.5">
              <Label className="text-xs">Gradient preset</Label>
              <Select
                value={config.confusionGradientPreset}
                onValueChange={applyConfusionGradientPreset}
              >
                <SelectTrigger className="h-9 w-full text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <MiniGradientBar gradient={config.confusionGradient} />
                    <span className="truncate">{getConfusionGradientLabel(config.confusionGradientPreset)}</span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {listConfusionGradients().map((gradient) => (
                    <SelectItem key={gradient.id} value={gradient.id} className="text-xs">
                      <div className="flex items-center gap-2">
                        <MiniGradientBar gradient={gradient.colors} />
                        <span>{gradient.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                  <SelectItem value="custom" className="text-xs">
                    <div className="flex items-center gap-2">
                      <MiniGradientBar gradient={config.confusionGradient} />
                      <span>Custom</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] leading-4 text-muted-foreground">
                Presets seed the gradient, then you can fine-tune the low and high stops for the matrix.
              </p>
            </div>
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
              <ColorInputRow
                label="Low cells"
                value={config.confusionGradient.low}
                onChange={(value) => updateConfusionGradient("low", value)}
              />
              <ColorInputRow
                label="High cells"
                value={config.confusionGradient.high}
                onChange={(value) => updateConfusionGradient("high", value)}
              />
            </div>
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
