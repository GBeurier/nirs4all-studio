import { describe, expect, it } from 'vitest';
import { getShapAxisDisplay } from './shapAxisDisplay';
import i18n from '@/lib/i18n';

const t = i18n.getFixedT('en');

describe('SHAP axis units', () => {
  it('preserves wavelength and wavenumber units without changing coordinates', () => {
    expect(getShapAxisDisplay('nm', t)).toEqual({ name: 'Wavelength', label: 'Wavelength (nm)', suffix: ' nm' });
    expect(getShapAxisDisplay('cm-1', t)).toEqual({ name: 'Wavenumber', label: 'Wavenumber (cm⁻¹)', suffix: ' cm⁻¹' });
    expect(getShapAxisDisplay('um', t).label).toBe('Wavelength (µm)');
  });

  it('labels feature indices and old results without inventing physical units', () => {
    expect(getShapAxisDisplay('index', t)).toEqual({ name: 'Feature index', label: 'Feature index', suffix: '' });
    for (const unit of [undefined, null, '', 'none', 'text']) {
      expect(getShapAxisDisplay(unit, t)).toEqual({ name: 'Spectral coordinate', label: 'Spectral coordinate', suffix: '' });
    }
  });
});
