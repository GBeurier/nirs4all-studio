import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { getComponentCategoryLabel, getComponentLabel } from "../definitionLabels";
import { ConfigSection } from "./ConfigSection";
import { SliderParam } from "./SliderParam";
import {
  CHEMICAL_COMPONENT_GROUPS,
  type FeaturesReadModel,
  type SelectedComponentBadge,
  type WavelengthRange,
} from "./FeaturesConfigData";

export function FeaturesConfigHeader() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10">
        <Waves className="h-4 w-4 text-blue-600" />
      </div>
      <div>
        <h3 className="text-sm font-semibold">{t("spectraSynthesis.features.header.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.features.header.subtitle")}
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
  const { t } = useTranslation();
  return (
    <ConfigSection
      title={t("spectraSynthesis.features.wavelength.title")}
      icon={<Radio className="h-4 w-4 text-blue-500" />}
      defaultOpen={true}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">{t("spectraSynthesis.features.wavelength.range")}</Label>
          <span className="text-xs text-muted-foreground">
            {t("spectraSynthesis.features.wavelength.points", { count: numWavelengths })}
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
        label={t("spectraSynthesis.features.wavelength.step")}
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
  const { t } = useTranslation();
  const [componentSearchOpen, setComponentSearchOpen] = useState(false);

  return (
    <ConfigSection
      title={t("spectraSynthesis.features.components.title")}
      icon={<Beaker className="h-4 w-4 text-green-500" />}
      defaultOpen={true}
      description={t("spectraSynthesis.features.components.description")}
    >
      <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 border rounded-md bg-muted/30">
        {selectedComponentBadges.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t("spectraSynthesis.features.components.none")}</span>
        ) : (
          selectedComponentBadges.map(({ name, label }) => (
            <Badge key={name} variant="secondary" className="gap-1 pr-1 text-xs">
              {label}
              <Button
                variant="ghost"
                size="icon"
                className="h-3 w-3 p-0 hover:bg-destructive/20"
                aria-label={t("spectraSynthesis.features.components.remove", { name: label })}
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
            <span className="text-muted-foreground">{t("spectraSynthesis.features.components.add")}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command>
            <CommandInput placeholder={t("spectraSynthesis.features.components.search")} className="h-8" />
            <CommandList>
              <CommandEmpty>{t("spectraSynthesis.features.components.empty")}</CommandEmpty>
              <ScrollArea className="h-[250px]">
                {Object.entries(CHEMICAL_COMPONENT_GROUPS).map(([category, comps]) => (
                  <CommandGroup
                    key={category}
                    heading={getComponentCategoryLabel(t, category)}
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
                            <span className="truncate">{getComponentLabel(t, comp.name)}</span>
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
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">{t("spectraSynthesis.features.complexity.label")}</Label>
        {complexity !== "custom" && (
          <Badge variant="outline" className="text-[10px]">
            {t("spectraSynthesis.features.complexity.presetBadge", { name: t(`spectraSynthesis.features.complexity.names.${complexity}`, { defaultValue: complexity }) })}
          </Badge>
        )}
      </div>
      <Select value={complexity} onValueChange={onComplexityChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="simple" className="text-xs">
            {t("spectraSynthesis.features.complexity.options.simple")}
          </SelectItem>
          <SelectItem value="realistic" className="text-xs">
            {t("spectraSynthesis.features.complexity.options.realistic")}
          </SelectItem>
          <SelectItem value="complex" className="text-xs">
            {t("spectraSynthesis.features.complexity.options.complex")}
          </SelectItem>
          <SelectItem value="custom" className="text-xs">
            {t("spectraSynthesis.features.complexity.options.custom")}
          </SelectItem>
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground">
        {complexity === "custom"
          ? t("spectraSynthesis.features.complexity.hintCustom")
          : t("spectraSynthesis.features.complexity.hintPreset")}
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
  const { t } = useTranslation();
  return (
    <>
      <ConfigSection
        title={t("spectraSynthesis.features.physics.beerLambert.title")}
        icon={<Activity className="h-4 w-4 text-purple-500" />}
        description={t("spectraSynthesis.features.physics.beerLambert.description")}
      >
        <SliderParam
          label={t("spectraSynthesis.features.physics.pathLength.label")}
          value={model.pathLengthStd}
          onChange={onPathLengthStdChange}
          min={0}
          max={0.2}
          step={0.01}
          tooltip={t("spectraSynthesis.features.physics.pathLength.tooltip")}
        />
      </ConfigSection>

      <ConfigSection
        title={t("spectraSynthesis.features.physics.baseline.title")}
        icon={<Activity className="h-4 w-4 text-orange-500" />}
        description={t("spectraSynthesis.features.physics.baseline.description")}
      >
        <SliderParam
          label={t("spectraSynthesis.features.physics.baselineAmplitude.label")}
          value={model.baselineAmplitude}
          onChange={onBaselineAmplitudeChange}
          min={0}
          max={0.2}
          step={0.005}
          tooltip={t("spectraSynthesis.features.physics.baselineAmplitude.tooltip")}
        />
        <SliderParam
          label={t("spectraSynthesis.features.physics.tilt.label")}
          value={model.tiltStd}
          onChange={onTiltStdChange}
          min={0}
          max={0.1}
          step={0.005}
          tooltip={t("spectraSynthesis.features.physics.tilt.tooltip")}
        />
        <SliderParam
          label={t("spectraSynthesis.features.physics.slopeMean.label")}
          value={model.globalSlopeMean}
          onChange={onGlobalSlopeMeanChange}
          min={-0.2}
          max={0.2}
          step={0.01}
          tooltip={t("spectraSynthesis.features.physics.slopeMean.tooltip")}
        />
        <SliderParam
          label={t("spectraSynthesis.features.physics.slopeStd.label")}
          value={model.globalSlopeStd}
          onChange={onGlobalSlopeStdChange}
          min={0}
          max={0.2}
          step={0.01}
          tooltip={t("spectraSynthesis.features.physics.slopeStd.tooltip")}
        />
      </ConfigSection>

      <ConfigSection
        title={t("spectraSynthesis.features.physics.scatter.title")}
        icon={<Zap className="h-4 w-4 text-cyan-500" />}
        description={t("spectraSynthesis.features.physics.scatter.description")}
      >
        <SliderParam
          label={t("spectraSynthesis.features.physics.scatterAlpha.label")}
          value={model.scatterAlphaStd}
          onChange={onScatterAlphaStdChange}
          min={0}
          max={0.2}
          step={0.01}
          tooltip={t("spectraSynthesis.features.physics.scatterAlpha.tooltip")}
        />
        <SliderParam
          label={t("spectraSynthesis.features.physics.scatterBeta.label")}
          value={model.scatterBetaStd}
          onChange={onScatterBetaStdChange}
          min={0}
          max={0.1}
          step={0.005}
          tooltip={t("spectraSynthesis.features.physics.scatterBeta.tooltip")}
        />
      </ConfigSection>

      <ConfigSection
        title={t("spectraSynthesis.features.physics.wavelengthEffects.title")}
        icon={<Radio className="h-4 w-4 text-yellow-500" />}
        description={t("spectraSynthesis.features.physics.wavelengthEffects.description")}
      >
        <SliderParam
          label={t("spectraSynthesis.features.physics.shift.label")}
          value={model.shiftStd}
          onChange={onShiftStdChange}
          min={0}
          max={5}
          step={0.1}
          unit="nm"
          precision={1}
          tooltip={t("spectraSynthesis.features.physics.shift.tooltip")}
        />
        <SliderParam
          label={t("spectraSynthesis.features.physics.stretch.label")}
          value={model.stretchStd}
          onChange={onStretchStdChange}
          min={0}
          max={0.01}
          step={0.0005}
          precision={4}
          tooltip={t("spectraSynthesis.features.physics.stretch.tooltip")}
        />
      </ConfigSection>

      <ConfigSection
        title={t("spectraSynthesis.features.physics.noise.title")}
        icon={<Activity className="h-4 w-4 text-red-500" />}
        description={t("spectraSynthesis.features.physics.noise.description")}
      >
        <SliderParam
          label={t("spectraSynthesis.features.physics.noiseBase.label")}
          value={model.noiseBase}
          onChange={onNoiseBaseChange}
          min={0}
          max={0.05}
          step={0.001}
          tooltip={t("spectraSynthesis.features.physics.noiseBase.tooltip")}
        />
        <SliderParam
          label={t("spectraSynthesis.features.physics.noiseSignal.label")}
          value={model.noiseSignalDep}
          onChange={onNoiseSignalDepChange}
          min={0}
          max={0.1}
          step={0.005}
          tooltip={t("spectraSynthesis.features.physics.noiseSignal.tooltip")}
        />
        <SliderParam
          label={t("spectraSynthesis.features.physics.artifact.label")}
          value={model.artifactProb}
          onChange={onArtifactProbChange}
          min={0}
          max={0.2}
          step={0.01}
          tooltip={t("spectraSynthesis.features.physics.artifact.tooltip")}
        />
      </ConfigSection>

      <ConfigSection
        title={t("spectraSynthesis.features.physics.broadening.title")}
        icon={<Gauge className="h-4 w-4 text-indigo-500" />}
      >
        <SliderParam
          label={t("spectraSynthesis.features.physics.fwhm.label")}
          value={model.instrumentalFwhm}
          onChange={onInstrumentalFwhmChange}
          min={1}
          max={30}
          step={1}
          unit="nm"
          precision={0}
          tooltip={t("spectraSynthesis.features.physics.fwhm.tooltip")}
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
  const { t } = useTranslation();
  return (
    <ConfigSection
      title={t("spectraSynthesis.features.instrument.title")}
      icon={<Settings2 className="h-4 w-4 text-slate-500" />}
      description={t("spectraSynthesis.features.instrument.description")}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("spectraSynthesis.features.instrument.archetype")}</Label>
          <Select
            value={instrumentSelectValue}
            onValueChange={onInstrumentChange}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={t("spectraSynthesis.features.instrument.generic")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">{t("spectraSynthesis.features.instrument.generic")}</SelectItem>
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
          <Label className="text-xs">{t("spectraSynthesis.features.instrument.mode")}</Label>
          <Select
            value={measurementModeSelectValue}
            onValueChange={onMeasurementModeChange}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={t("spectraSynthesis.features.instrument.modeDefault")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">{t("spectraSynthesis.features.instrument.modeDefault")}</SelectItem>
              <SelectItem value="transmittance" className="text-xs">{t("spectraSynthesis.features.instrument.modes.transmittance")}</SelectItem>
              <SelectItem value="reflectance" className="text-xs">{t("spectraSynthesis.features.instrument.modes.reflectance")}</SelectItem>
              <SelectItem value="transflectance" className="text-xs">{t("spectraSynthesis.features.instrument.modes.transflectance")}</SelectItem>
              <SelectItem value="interactance" className="text-xs">{t("spectraSynthesis.features.instrument.modes.interactance")}</SelectItem>
              <SelectItem value="atr" className="text-xs">ATR</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </ConfigSection>
  );
}
