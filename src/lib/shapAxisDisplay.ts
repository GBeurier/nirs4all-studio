import type { TFunction } from 'i18next';
import { formatWavelengthUnit } from '@/components/playground/visualizations/chartConfig';

/** A missing persisted unit is unknown; a feature index is not a wavelength. */
export function getShapAxisDisplay(axisUnit: string | null | undefined, t: TFunction) {
  const unit = formatWavelengthUnit(axisUnit);
  const name = axisUnit === 'index' ? t('results.variableImportance.axis.featureIndex')
    : unit === 'cm⁻¹' ? t('results.variableImportance.axis.wavenumber')
      : unit === 'nm' || unit === 'µm' ? t('results.variableImportance.axis.wavelength') : t('results.variableImportance.axis.spectralCoordinate');
  return {
    name,
    label: unit ? `${name} (${unit})` : name,
    suffix: unit ? ` ${unit}` : '',
  };
}
