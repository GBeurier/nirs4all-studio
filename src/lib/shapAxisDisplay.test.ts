import { describe, expect, it } from 'vitest';
import { getShapAxisDisplay } from './shapAxisDisplay';

describe('SHAP axis units', () => {
  it('preserves wavelength and wavenumber units without changing coordinates', () => {
    expect(getShapAxisDisplay('nm')).toEqual({ name: 'Wavelength', label: 'Wavelength (nm)', suffix: ' nm' });
    expect(getShapAxisDisplay('cm-1')).toEqual({ name: 'Wavenumber', label: 'Wavenumber (cm⁻¹)', suffix: ' cm⁻¹' });
    expect(getShapAxisDisplay('um').label).toBe('Wavelength (µm)');
  });

  it('labels feature indices and old results without inventing physical units', () => {
    expect(getShapAxisDisplay('index')).toEqual({ name: 'Feature index', label: 'Feature index', suffix: '' });
    for (const unit of [undefined, null, '', 'none', 'text']) {
      expect(getShapAxisDisplay(unit)).toEqual({ name: 'Spectral coordinate', label: 'Spectral coordinate', suffix: '' });
    }
  });
});
