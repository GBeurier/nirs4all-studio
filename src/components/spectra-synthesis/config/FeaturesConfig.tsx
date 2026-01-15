/**
 * FeaturesConfig - Advanced configuration panel for with_features() step
 *
 * Provides detailed scientific control over synthetic spectra generation:
 * - Wavelength configuration
 * - Chemical components selection
 * - Physics parameters (baseline, scatter, noise)
 * - Instrument simulation
 * - Measurement mode
 */

import { useState, useMemo, useCallback } from "react";
import {
  Waves,
  X,
  Check,
  ChevronDown,
  ChevronRight,
  Beaker,
  Activity,
  Radio,
  Gauge,
  Zap,
  Settings2,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { CHEMICAL_COMPONENTS } from "../definitions";
import type { SynthesisStepDefinition } from "../types";
import { cn } from "@/lib/utils";

// Complexity presets (matching nirs4all)
const COMPLEXITY_PRESETS = {
  simple: {
    path_length_std: 0.02,
    baseline_amplitude: 0.01,
    scatter_alpha_std: 0.02,
    scatter_beta_std: 0.005,
    tilt_std: 0.005,
    global_slope_mean: 0.0,
    global_slope_std: 0.02,
    shift_std: 0.2,
    stretch_std: 0.0005,
    instrumental_fwhm: 4,
    noise_base: 0.002,
    noise_signal_dep: 0.005,
    artifact_prob: 0.0,
  },
  realistic: {
    path_length_std: 0.05,
    baseline_amplitude: 0.02,
    scatter_alpha_std: 0.05,
    scatter_beta_std: 0.01,
    tilt_std: 0.01,
    global_slope_mean: 0.05,
    global_slope_std: 0.03,
    shift_std: 0.5,
    stretch_std: 0.001,
    instrumental_fwhm: 8,
    noise_base: 0.005,
    noise_signal_dep: 0.01,
    artifact_prob: 0.02,
  },
  complex: {
    path_length_std: 0.08,
    baseline_amplitude: 0.05,
    scatter_alpha_std: 0.08,
    scatter_beta_std: 0.02,
    tilt_std: 0.02,
    global_slope_mean: 0.08,
    global_slope_std: 0.05,
    shift_std: 1.0,
    stretch_std: 0.002,
    instrumental_fwhm: 12,
    noise_base: 0.008,
    noise_signal_dep: 0.015,
    artifact_prob: 0.05,
  },
};

interface FeaturesConfigProps {
  params: Record<string, unknown>;
  definition: SynthesisStepDefinition;
  onChange: (params: Record<string, unknown>) => void;
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  description?: string;
}

function ConfigSection({ title, icon, children, defaultOpen = false, description }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between py-2 text-sm font-medium hover:bg-muted/50 rounded-md px-2 -mx-2">
        <div className="flex items-center gap-2">
          {icon}
          <span>{title}</span>
        </div>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 pb-4 space-y-3">
        {description && (
          <p className="text-xs text-muted-foreground -mt-1 mb-3">{description}</p>
        )}
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

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

function SliderParam({
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

export function FeaturesConfig({
  params,
  definition,
  onChange,
}: FeaturesConfigProps) {
  const [componentSearchOpen, setComponentSearchOpen] = useState(false);

  // Extract params with defaults
  const wavelengthRange = (params.wavelength_range as [number, number]) || [1000, 2500];
  const wavelengthStep = (params.wavelength_step as number) ?? 2.0;
  const complexity = (params.complexity as string) || "custom";
  const components = (params.components as string[]) || ["water", "protein", "lipid"];

  // Physics params
  const pathLengthStd = (params.path_length_std as number) ?? 0.05;
  const baselineAmplitude = (params.baseline_amplitude as number) ?? 0.02;
  const scatterAlphaStd = (params.scatter_alpha_std as number) ?? 0.05;
  const scatterBetaStd = (params.scatter_beta_std as number) ?? 0.01;
  const tiltStd = (params.tilt_std as number) ?? 0.01;
  const globalSlopeMean = (params.global_slope_mean as number) ?? 0.05;
  const globalSlopeStd = (params.global_slope_std as number) ?? 0.03;
  const shiftStd = (params.shift_std as number) ?? 0.5;
  const stretchStd = (params.stretch_std as number) ?? 0.001;
  const instrumentalFwhm = (params.instrumental_fwhm as number) ?? 8;
  const noiseBase = (params.noise_base as number) ?? 0.005;
  const noiseSignalDep = (params.noise_signal_dep as number) ?? 0.01;
  const artifactProb = (params.artifact_prob as number) ?? 0.02;

  // Instrument
  const instrument = (params.instrument as string | null) ?? null;
  const measurementMode = (params.measurement_mode as string | null) ?? null;

  const numWavelengths = useMemo(() => {
    return Math.floor((wavelengthRange[1] - wavelengthRange[0]) / wavelengthStep) + 1;
  }, [wavelengthRange, wavelengthStep]);

  // Apply complexity preset
  const handleComplexityChange = useCallback(
    (value: string) => {
      if (value === "custom") {
        onChange({ complexity: value });
      } else {
        const preset = COMPLEXITY_PRESETS[value as keyof typeof COMPLEXITY_PRESETS];
        onChange({
          complexity: value,
          ...preset,
        });
      }
    },
    [onChange]
  );

  const handleWavelengthRangeChange = (values: number[]) => {
    onChange({ wavelength_range: [values[0], values[1]] });
  };

  const handleComponentToggle = (componentName: string) => {
    const newComponents = components.includes(componentName)
      ? components.filter((c) => c !== componentName)
      : [...components, componentName];
    onChange({ components: newComponents });
  };

  const handleRemoveComponent = (componentName: string) => {
    onChange({ components: components.filter((c) => c !== componentName) });
  };

  // Group components by category
  const componentsByCategory = useMemo(() => {
    const groups: Record<string, typeof CHEMICAL_COMPONENTS> = {};
    for (const comp of CHEMICAL_COMPONENTS) {
      if (!groups[comp.category]) {
        groups[comp.category] = [];
      }
      groups[comp.category].push(comp);
    }
    return groups;
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10">
          <Waves className="h-4 w-4 text-blue-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Features Configuration</h3>
          <p className="text-xs text-muted-foreground">
            Physics-based spectral simulation
          </p>
        </div>
      </div>

      <Separator />

      {/* Wavelength Section - Always visible */}
      <ConfigSection
        title="Wavelength Configuration"
        icon={<Radio className="h-4 w-4 text-blue-500" />}
        defaultOpen={true}
      >
        {/* Wavelength Range */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Range</Label>
            <span className="text-xs text-muted-foreground">
              {numWavelengths} points
            </span>
          </div>
          <Slider
            value={wavelengthRange}
            min={350}
            max={3000}
            step={10}
            onValueChange={handleWavelengthRangeChange}
            className="w-full"
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                type="number"
                value={wavelengthRange[0]}
                onChange={(e) =>
                  handleWavelengthRangeChange([
                    parseInt(e.target.value) || 350,
                    wavelengthRange[1],
                  ])
                }
                min={350}
                max={wavelengthRange[1] - 10}
                className="h-7 text-xs"
              />
            </div>
            <span className="text-muted-foreground self-center">-</span>
            <div className="flex-1">
              <Input
                type="number"
                value={wavelengthRange[1]}
                onChange={(e) =>
                  handleWavelengthRangeChange([
                    wavelengthRange[0],
                    parseInt(e.target.value) || 3000,
                  ])
                }
                min={wavelengthRange[0] + 10}
                max={3000}
                className="h-7 text-xs"
              />
            </div>
            <span className="text-muted-foreground text-xs self-center">nm</span>
          </div>
        </div>

        {/* Wavelength Step */}
        <SliderParam
          label="Step"
          value={wavelengthStep}
          onChange={(v) => onChange({ wavelength_step: v })}
          min={0.5}
          max={10}
          step={0.5}
          unit="nm"
          precision={1}
        />
      </ConfigSection>

      <Separator />

      {/* Chemical Components */}
      <ConfigSection
        title="Chemical Components"
        icon={<Beaker className="h-4 w-4 text-green-500" />}
        defaultOpen={true}
        description="Select NIR-active components to include in spectra"
      >
        {/* Selected components */}
        <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 border rounded-md bg-muted/30">
          {components.length === 0 ? (
            <span className="text-xs text-muted-foreground">No components selected</span>
          ) : (
            components.map((name) => {
              const comp = CHEMICAL_COMPONENTS.find((c) => c.name === name);
              return (
                <Badge key={name} variant="secondary" className="gap-1 pr-1 text-xs">
                  {comp?.displayName || name}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-3 w-3 p-0 hover:bg-destructive/20"
                    onClick={() => handleRemoveComponent(name)}
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </Badge>
              );
            })
          )}
        </div>

        {/* Component selector */}
        <Popover open={componentSearchOpen} onOpenChange={setComponentSearchOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-start h-8 text-xs">
              <span className="text-muted-foreground">Add components...</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search components..." className="h-8" />
              <CommandList>
                <CommandEmpty>No components found.</CommandEmpty>
                <ScrollArea className="h-[250px]">
                  {Object.entries(componentsByCategory).map(([category, comps]) => (
                    <CommandGroup
                      key={category}
                      heading={category.charAt(0).toUpperCase() + category.slice(1)}
                    >
                      {comps.map((comp) => {
                        const isSelected = components.includes(comp.name);
                        return (
                          <CommandItem
                            key={comp.name}
                            value={comp.name}
                            onSelect={() => handleComponentToggle(comp.name)}
                            className="text-xs"
                          >
                            <div
                              className={cn(
                                "mr-2 flex h-3.5 w-3.5 items-center justify-center rounded-sm border",
                                isSelected ? "bg-primary border-primary" : "border-muted-foreground"
                              )}
                            >
                              {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                            </div>
                            <div className="flex-1 overflow-hidden">
                              <span className="truncate">{comp.displayName}</span>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ))}
                </ScrollArea>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </ConfigSection>

      <Separator />

      {/* Quick Preset */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Complexity Preset</Label>
          {complexity !== "custom" && (
            <Badge variant="outline" className="text-[10px]">
              Preset: {complexity}
            </Badge>
          )}
        </div>
        <Select value={complexity} onValueChange={handleComplexityChange}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="simple" className="text-xs">
              Simple - Ideal conditions
            </SelectItem>
            <SelectItem value="realistic" className="text-xs">
              Realistic - Typical NIR
            </SelectItem>
            <SelectItem value="complex" className="text-xs">
              Complex - Challenging
            </SelectItem>
            <SelectItem value="custom" className="text-xs">
              Custom - Manual config
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          {complexity === "custom"
            ? "Configure physics parameters manually below"
            : "Preset applied. Modify parameters to switch to custom mode."}
        </p>
      </div>

      <Separator />

      {/* Physics Parameters */}
      <ConfigSection
        title="Beer-Lambert Physics"
        icon={<Activity className="h-4 w-4 text-purple-500" />}
        description="A = ε·c·L (absorbance = molar absorptivity × concentration × path length)"
      >
        <SliderParam
          label="Path Length Variation"
          value={pathLengthStd}
          onChange={(v) => onChange({ path_length_std: v, complexity: "custom" })}
          min={0}
          max={0.2}
          step={0.01}
          tooltip="Standard deviation of optical path length (L factor). Higher values = more sample thickness variation."
        />
      </ConfigSection>

      <ConfigSection
        title="Baseline & Drift"
        icon={<Activity className="h-4 w-4 text-orange-500" />}
        description="Polynomial baseline effects and spectral tilt"
      >
        <SliderParam
          label="Baseline Amplitude"
          value={baselineAmplitude}
          onChange={(v) => onChange({ baseline_amplitude: v, complexity: "custom" })}
          min={0}
          max={0.2}
          step={0.005}
          tooltip="Amplitude of polynomial baseline drift"
        />
        <SliderParam
          label="Spectral Tilt"
          value={tiltStd}
          onChange={(v) => onChange({ tilt_std: v, complexity: "custom" })}
          min={0}
          max={0.1}
          step={0.005}
          tooltip="Linear tilt variation across spectra"
        />
        <SliderParam
          label="Global Slope Mean"
          value={globalSlopeMean}
          onChange={(v) => onChange({ global_slope_mean: v, complexity: "custom" })}
          min={-0.2}
          max={0.2}
          step={0.01}
          tooltip="Mean slope across all spectra (systematic baseline)"
        />
        <SliderParam
          label="Global Slope Std"
          value={globalSlopeStd}
          onChange={(v) => onChange({ global_slope_std: v, complexity: "custom" })}
          min={0}
          max={0.2}
          step={0.01}
          tooltip="Variation in global slope between samples"
        />
      </ConfigSection>

      <ConfigSection
        title="Scattering Effects"
        icon={<Zap className="h-4 w-4 text-cyan-500" />}
        description="MSC-style multiplicative and additive scatter"
      >
        <SliderParam
          label="Scatter Alpha (Multiplicative)"
          value={scatterAlphaStd}
          onChange={(v) => onChange({ scatter_alpha_std: v, complexity: "custom" })}
          min={0}
          max={0.2}
          step={0.01}
          tooltip="MSC-like multiplicative scattering coefficient (α). Affects overall intensity."
        />
        <SliderParam
          label="Scatter Beta (Additive)"
          value={scatterBetaStd}
          onChange={(v) => onChange({ scatter_beta_std: v, complexity: "custom" })}
          min={0}
          max={0.1}
          step={0.005}
          tooltip="Additive scattering offset (β). Adds constant offset."
        />
      </ConfigSection>

      <ConfigSection
        title="Wavelength Effects"
        icon={<Radio className="h-4 w-4 text-yellow-500" />}
        description="Wavelength axis shift and stretch (calibration variation)"
      >
        <SliderParam
          label="Wavelength Shift"
          value={shiftStd}
          onChange={(v) => onChange({ shift_std: v, complexity: "custom" })}
          min={0}
          max={5}
          step={0.1}
          unit="nm"
          precision={1}
          tooltip="Random wavelength axis shift simulating calibration variation"
        />
        <SliderParam
          label="Wavelength Stretch"
          value={stretchStd}
          onChange={(v) => onChange({ stretch_std: v, complexity: "custom" })}
          min={0}
          max={0.01}
          step={0.0005}
          precision={4}
          tooltip="Wavelength axis stretching/compression factor"
        />
      </ConfigSection>

      <ConfigSection
        title="Noise Model"
        icon={<Activity className="h-4 w-4 text-red-500" />}
        description="Detector noise and signal-dependent shot noise"
      >
        <SliderParam
          label="Base Noise (Detector)"
          value={noiseBase}
          onChange={(v) => onChange({ noise_base: v, complexity: "custom" })}
          min={0}
          max={0.05}
          step={0.001}
          tooltip="Constant noise floor from detector (dark noise)"
        />
        <SliderParam
          label="Signal-Dependent Noise"
          value={noiseSignalDep}
          onChange={(v) => onChange({ noise_signal_dep: v, complexity: "custom" })}
          min={0}
          max={0.1}
          step={0.005}
          tooltip="Noise proportional to signal intensity (shot noise)"
        />
        <SliderParam
          label="Artifact Probability"
          value={artifactProb}
          onChange={(v) => onChange({ artifact_prob: v, complexity: "custom" })}
          min={0}
          max={0.2}
          step={0.01}
          tooltip="Probability of spectral artifacts (spikes, dropouts)"
        />
      </ConfigSection>

      <ConfigSection
        title="Instrumental Broadening"
        icon={<Gauge className="h-4 w-4 text-indigo-500" />}
      >
        <SliderParam
          label="Instrumental FWHM"
          value={instrumentalFwhm}
          onChange={(v) => onChange({ instrumental_fwhm: v, complexity: "custom" })}
          min={1}
          max={30}
          step={1}
          unit="nm"
          precision={0}
          tooltip="Full width at half maximum of instrumental line shape"
        />
      </ConfigSection>

      <Separator />

      {/* Instrument Simulation */}
      <ConfigSection
        title="Instrument Simulation"
        icon={<Settings2 className="h-4 w-4 text-slate-500" />}
        description="Simulate specific instrument characteristics (Phase 2)"
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Instrument Archetype</Label>
            <Select
              value={instrument || "none"}
              onValueChange={(v) => onChange({ instrument: v === "none" ? null : v })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Generic" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">Generic</SelectItem>
                <SelectItem value="foss_xds" className="text-xs">FOSS XDS</SelectItem>
                <SelectItem value="foss_nirs_ds2500" className="text-xs">FOSS NIRS DS2500</SelectItem>
                <SelectItem value="bruker_mpa" className="text-xs">Bruker MPA</SelectItem>
                <SelectItem value="bruker_tango" className="text-xs">Bruker TANGO</SelectItem>
                <SelectItem value="agilent_4500" className="text-xs">Agilent 4500</SelectItem>
                <SelectItem value="thermo_antaris" className="text-xs">Thermo Antaris</SelectItem>
                <SelectItem value="si_ware_neospectra" className="text-xs">Si-Ware NeoSpectra</SelectItem>
                <SelectItem value="scio_consumer" className="text-xs">SCiO Consumer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Measurement Mode</Label>
            <Select
              value={measurementMode || "none"}
              onValueChange={(v) => onChange({ measurement_mode: v === "none" ? null : v })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">Default</SelectItem>
                <SelectItem value="transmittance" className="text-xs">Transmittance</SelectItem>
                <SelectItem value="reflectance" className="text-xs">Reflectance</SelectItem>
                <SelectItem value="transflectance" className="text-xs">Transflectance</SelectItem>
                <SelectItem value="interactance" className="text-xs">Interactance</SelectItem>
                <SelectItem value="atr" className="text-xs">ATR</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </ConfigSection>
    </div>
  );
}
