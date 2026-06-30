export interface SpectraTooltipPayloadEntry {
  payload?: Record<string, number | undefined>;
}

export interface SpectraSampleTooltipProps {
  enableHover: boolean;
  active?: boolean;
  payload?: SpectraTooltipPayloadEntry[];
  hoveredSample: number | null;
  sampleIds?: string[];
  targetValues?: number[];
  foldLabels?: number[];
  displayIndices: number[];
  wavelengthAxisName: string;
  wavelengthUnitSuffix: string;
}

export function SpectraSampleTooltip({
  enableHover,
  active,
  payload,
  hoveredSample,
  sampleIds,
  targetValues,
  foldLabels,
  displayIndices,
  wavelengthAxisName,
  wavelengthUnitSuffix,
}: SpectraSampleTooltipProps) {
  if (!enableHover || !active || hoveredSample === null) {
    return null;
  }

  const sampleId = sampleIds?.[hoveredSample] ?? `Sample ${hoveredSample}`;
  const yValue = targetValues?.[hoveredSample];
  const foldLabel = foldLabels?.[hoveredSample];
  const row = payload?.[0]?.payload;
  const wavelength = row?.wavelength;
  const displayIndex = displayIndices.indexOf(hoveredSample);
  const spectrumValue = displayIndex >= 0 && row
    ? row[`p${displayIndex}`] ?? row[`o${displayIndex}`]
    : undefined;

  return (
    <div className="bg-popover border border-border rounded-md px-2 py-1.5 shadow-md text-[10px]">
      <div className="font-medium text-foreground mb-0.5">{sampleId}</div>
      {yValue !== undefined && (
        <div className="text-muted-foreground">Y: <span className="font-mono">{yValue.toFixed(3)}</span></div>
      )}
      {foldLabel !== undefined && foldLabel >= 0 && (
        <div className="text-muted-foreground">Fold: {foldLabel + 1}</div>
      )}
      {wavelength !== undefined && (
        <div className="text-muted-foreground">
          {wavelengthAxisName === 'Wavenumber' ? 'ν' : 'λ'}:{' '}
          <span className="font-mono">{wavelength.toFixed(1)}{wavelengthUnitSuffix}</span>
        </div>
      )}
      {spectrumValue !== undefined && (
        <div className="text-muted-foreground">A: <span className="font-mono">{spectrumValue.toFixed(4)}</span></div>
      )}
    </div>
  );
}
