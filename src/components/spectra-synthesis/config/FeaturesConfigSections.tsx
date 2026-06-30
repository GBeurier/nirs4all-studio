import { useState } from "react";
import {
  Activity,
  Beaker,
  Check,
  Gauge,
  Radio,
  Settings2,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { ConfigSection } from "./ConfigSection";
import { SliderParam } from "./SliderParam";
import {
  CHEMICAL_COMPONENT_GROUPS,
  formatComponentCategoryLabel,
  type FeaturesReadModel,
  type SelectedComponentBadge,
  type WavelengthRange,
} from "./FeaturesConfigData";

export function FeaturesConfigHeader() {
  return (
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
  );
}

interface WavelengthConfigSectionProps {
  wavelengthRange: WavelengthRange;
  wavelengthStep: number;
  numWavelengths: number;
  onRangeChange: (values: number[]) => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onStepChange: (value: number) => void;
}

export function WavelengthConfigSection({
  wavelengthRange,
  wavelengthStep,
  numWavelengths,
  onRangeChange,
  onStartChange,
  onEndChange,
  onStepChange,
}: WavelengthConfigSectionProps) {
  return (
    <ConfigSection
      title="Wavelength Configuration"
      icon={<Radio className="h-4 w-4 text-blue-500" />}
      defaultOpen={true}
    >
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
          onValueChange={onRangeChange}
          className="w-full"
        />
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              type="number"
              value={wavelengthRange[0]}
              onChange={(e) => onStartChange(e.target.value)}
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
              onChange={(e) => onEndChange(e.target.value)}
              min={wavelengthRange[0] + 10}
              max={3000}
              className="h-7 text-xs"
            />
          </div>
          <span className="text-muted-foreground text-xs self-center">nm</span>
        </div>
      </div>

      <SliderParam
        label="Step"
        value={wavelengthStep}
        onChange={onStepChange}
        min={0.5}
        max={10}
        step={0.5}
        unit="nm"
        precision={1}
      />
    </ConfigSection>
  );
}

interface ChemicalComponentsSectionProps {
  components: string[];
  selectedComponentBadges: SelectedComponentBadge[];
  onToggleComponent: (componentName: string) => void;
  onRemoveComponent: (componentName: string) => void;
}

export function ChemicalComponentsSection({
  components,
  selectedComponentBadges,
  onToggleComponent,
  onRemoveComponent,
}: ChemicalComponentsSectionProps) {
  const [componentSearchOpen, setComponentSearchOpen] = useState(false);

  return (
    <ConfigSection
      title="Chemical Components"
      icon={<Beaker className="h-4 w-4 text-green-500" />}
      defaultOpen={true}
      description="Select NIR-active components to include in spectra"
    >
      <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 border rounded-md bg-muted/30">
        {selectedComponentBadges.length === 0 ? (
          <span className="text-xs text-muted-foreground">No components selected</span>
        ) : (
          selectedComponentBadges.map(({ name, label }) => (
            <Badge key={name} variant="secondary" className="gap-1 pr-1 text-xs">
              {label}
              <Button
                variant="ghost"
                size="icon"
                className="h-3 w-3 p-0 hover:bg-destructive/20"
                onClick={() => onRemoveComponent(name)}
              >
                <X className="h-2.5 w-2.5" />
              </Button>
            </Badge>
          ))
        )}
      </div>

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
                {Object.entries(CHEMICAL_COMPONENT_GROUPS).map(([category, comps]) => (
                  <CommandGroup
                    key={category}
                    heading={formatComponentCategoryLabel(category)}
                  >
                    {comps.map((comp) => {
                      const isSelected = components.includes(comp.name);
                      return (
                        <CommandItem
                          key={comp.name}
                          value={comp.name}
                          onSelect={() => onToggleComponent(comp.name)}
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
  );
}

interface ComplexityPresetControlProps {
  complexity: string;
  onComplexityChange: (value: string) => void;
}

export function ComplexityPresetControl({
  complexity,
  onComplexityChange,
}: ComplexityPresetControlProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Complexity Preset</Label>
        {complexity !== "custom" && (
          <Badge variant="outline" className="text-[10px]">
            Preset: {complexity}
          </Badge>
        )}
      </div>
      <Select value={complexity} onValueChange={onComplexityChange}>
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
  );
}

interface PhysicsParametersSectionsProps {
  model: Pick<
    FeaturesReadModel,
    | "pathLengthStd"
    | "baselineAmplitude"
    | "scatterAlphaStd"
    | "scatterBetaStd"
    | "tiltStd"
    | "globalSlopeMean"
    | "globalSlopeStd"
    | "shiftStd"
    | "stretchStd"
    | "instrumentalFwhm"
    | "noiseBase"
    | "noiseSignalDep"
    | "artifactProb"
  >;
  onPathLengthStdChange: (value: number) => void;
  onBaselineAmplitudeChange: (value: number) => void;
  onTiltStdChange: (value: number) => void;
  onGlobalSlopeMeanChange: (value: number) => void;
  onGlobalSlopeStdChange: (value: number) => void;
  onScatterAlphaStdChange: (value: number) => void;
  onScatterBetaStdChange: (value: number) => void;
  onShiftStdChange: (value: number) => void;
  onStretchStdChange: (value: number) => void;
  onNoiseBaseChange: (value: number) => void;
  onNoiseSignalDepChange: (value: number) => void;
  onArtifactProbChange: (value: number) => void;
  onInstrumentalFwhmChange: (value: number) => void;
}

export function PhysicsParametersSections({
  model,
  onPathLengthStdChange,
  onBaselineAmplitudeChange,
  onTiltStdChange,
  onGlobalSlopeMeanChange,
  onGlobalSlopeStdChange,
  onScatterAlphaStdChange,
  onScatterBetaStdChange,
  onShiftStdChange,
  onStretchStdChange,
  onNoiseBaseChange,
  onNoiseSignalDepChange,
  onArtifactProbChange,
  onInstrumentalFwhmChange,
}: PhysicsParametersSectionsProps) {
  return (
    <>
      <ConfigSection
        title="Beer-Lambert Physics"
        icon={<Activity className="h-4 w-4 text-purple-500" />}
        description="A = ε·c·L (absorbance = molar absorptivity × concentration × path length)"
      >
        <SliderParam
          label="Path Length Variation"
          value={model.pathLengthStd}
          onChange={onPathLengthStdChange}
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
          value={model.baselineAmplitude}
          onChange={onBaselineAmplitudeChange}
          min={0}
          max={0.2}
          step={0.005}
          tooltip="Amplitude of polynomial baseline drift"
        />
        <SliderParam
          label="Spectral Tilt"
          value={model.tiltStd}
          onChange={onTiltStdChange}
          min={0}
          max={0.1}
          step={0.005}
          tooltip="Linear tilt variation across spectra"
        />
        <SliderParam
          label="Global Slope Mean"
          value={model.globalSlopeMean}
          onChange={onGlobalSlopeMeanChange}
          min={-0.2}
          max={0.2}
          step={0.01}
          tooltip="Mean slope across all spectra (systematic baseline)"
        />
        <SliderParam
          label="Global Slope Std"
          value={model.globalSlopeStd}
          onChange={onGlobalSlopeStdChange}
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
          value={model.scatterAlphaStd}
          onChange={onScatterAlphaStdChange}
          min={0}
          max={0.2}
          step={0.01}
          tooltip="MSC-like multiplicative scattering coefficient (α). Affects overall intensity."
        />
        <SliderParam
          label="Scatter Beta (Additive)"
          value={model.scatterBetaStd}
          onChange={onScatterBetaStdChange}
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
          value={model.shiftStd}
          onChange={onShiftStdChange}
          min={0}
          max={5}
          step={0.1}
          unit="nm"
          precision={1}
          tooltip="Random wavelength axis shift simulating calibration variation"
        />
        <SliderParam
          label="Wavelength Stretch"
          value={model.stretchStd}
          onChange={onStretchStdChange}
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
          value={model.noiseBase}
          onChange={onNoiseBaseChange}
          min={0}
          max={0.05}
          step={0.001}
          tooltip="Constant noise floor from detector (dark noise)"
        />
        <SliderParam
          label="Signal-Dependent Noise"
          value={model.noiseSignalDep}
          onChange={onNoiseSignalDepChange}
          min={0}
          max={0.1}
          step={0.005}
          tooltip="Noise proportional to signal intensity (shot noise)"
        />
        <SliderParam
          label="Artifact Probability"
          value={model.artifactProb}
          onChange={onArtifactProbChange}
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
          value={model.instrumentalFwhm}
          onChange={onInstrumentalFwhmChange}
          min={1}
          max={30}
          step={1}
          unit="nm"
          precision={0}
          tooltip="Full width at half maximum of instrumental line shape"
        />
      </ConfigSection>
    </>
  );
}

interface InstrumentSimulationSectionProps {
  instrumentSelectValue: string;
  measurementModeSelectValue: string;
  onInstrumentChange: (value: string) => void;
  onMeasurementModeChange: (value: string) => void;
}

export function InstrumentSimulationSection({
  instrumentSelectValue,
  measurementModeSelectValue,
  onInstrumentChange,
  onMeasurementModeChange,
}: InstrumentSimulationSectionProps) {
  return (
    <ConfigSection
      title="Instrument Simulation"
      icon={<Settings2 className="h-4 w-4 text-slate-500" />}
      description="Simulate specific instrument characteristics (Phase 2)"
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Instrument Archetype</Label>
          <Select
            value={instrumentSelectValue}
            onValueChange={onInstrumentChange}
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
            value={measurementModeSelectValue}
            onValueChange={onMeasurementModeChange}
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
  );
}
