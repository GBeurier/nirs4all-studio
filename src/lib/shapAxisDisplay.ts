import { formatWavelengthUnit } from '@/components/playground/visualizations/chartConfig';

/** A missing persisted unit is unknown; a feature index is not a wavelength. */
export function getShapAxisDisplay(axisUnit?: string | null) {
  const unit = formatWavelengthUnit(axisUnit);
  const name = axisUnit === 'index' ? 'Feature index'
    : unit === 'cm⁻¹' ? 'Wavenumber'
      : unit === 'nm' || unit === 'µm' ? 'Wavelength' : 'Spectral coordinate';
  return {
    name,
    label: unit ? `${name} (${unit})` : name,
    suffix: unit ? ` ${unit}` : '',
  };
}
