import { describe, expect, it } from 'vitest';

import { DEFAULT_SPECTRA_CHART_CONFIG } from '@/lib/playground/spectraConfig';

import {
  buildMetadataPreviewText,
  buildSpectraSettingsReadModel,
  buildTargetRangeLabels,
  buildWavelengthRangeLabels,
  countFilterModifiedSettings,
  countFocusModifiedSettings,
  countSpectraSettingsModifications,
} from '../SpectraSettingsPopupData';

describe('SpectraSettingsPopupData', () => {
  it('counts focus modifications from range, derivative, and edge mask settings', () => {
    expect(countFocusModifiedSettings(DEFAULT_SPECTRA_CHART_CONFIG.wavelengthFocus)).toBe(0);

    expect(countFocusModifiedSettings({
      ...DEFAULT_SPECTRA_CHART_CONFIG.wavelengthFocus,
      range: [1000, 1600],
      derivative: 2,
      edgeMask: {
        enabled: true,
        start: 3,
        end: 4,
      },
    })).toBe(3);
  });

  it('counts filter modifications from partition, target range, and QC status settings', () => {
    expect(countFilterModifiedSettings(DEFAULT_SPECTRA_CHART_CONFIG.filters)).toBe(0);

    expect(countFilterModifiedSettings({
      ...DEFAULT_SPECTRA_CHART_CONFIG.filters,
      partition: 'fold',
      foldIndex: 1,
      targetRange: [0.2, 0.8],
      qcStatus: 'accepted',
    })).toBe(3);

    expect(countFilterModifiedSettings({
      ...DEFAULT_SPECTRA_CHART_CONFIG.filters,
      foldIndex: 2,
      qcStatus: 'all',
    })).toBe(0);
  });

  it('adds focus and filter modifications for the total settings count', () => {
    const config = {
      ...DEFAULT_SPECTRA_CHART_CONFIG,
      wavelengthFocus: {
        ...DEFAULT_SPECTRA_CHART_CONFIG.wavelengthFocus,
        range: [900, 1700] as [number, number],
        derivative: 1 as const,
      },
      filters: {
        ...DEFAULT_SPECTRA_CHART_CONFIG.filters,
        partition: 'test' as const,
        targetRange: [1, 2] as [number, number],
      },
    };

    expect(countSpectraSettingsModifications(config)).toBe(4);
  });

  it('formats active wavelength range labels with the configured unit suffix', () => {
    expect(buildWavelengthRangeLabels(null, [900, 1800], ' nm')).toEqual({
      start: '900 nm',
      end: '1800 nm',
    });

    expect(buildWavelengthRangeLabels([1000.2, 1200.7], [900, 1800], ' cm^-1')).toEqual({
      start: '1000 cm^-1',
      end: '1201 cm^-1',
    });
  });

  it('formats active target range labels when Y values are available', () => {
    expect(buildTargetRangeLabels(undefined, [0.123, 9.876])).toEqual({
      start: '0.12',
      end: '9.88',
    });

    expect(buildTargetRangeLabels([1.234, 4.567], [0, 10])).toEqual({
      start: '1.23',
      end: '4.57',
    });

    expect(buildTargetRangeLabels([1, 2], undefined)).toBeNull();
  });

  it('builds metadata preview text without rendering-specific branching', () => {
    expect(buildMetadataPreviewText(undefined)).toBeNull();
    expect(buildMetadataPreviewText([])).toBeNull();
    expect(buildMetadataPreviewText(['batch'])).toBe('Coming soon: Filter by batch');
    expect(buildMetadataPreviewText(['batch', 'site'])).toBe('Coming soon: Filter by batch, site');
    expect(buildMetadataPreviewText(['batch', 'site', 'operator'])).toBe(
      'Coming soon: Filter by batch, site +1 more'
    );
  });

  it('builds the popup read model from config and available ranges', () => {
    const readModel = buildSpectraSettingsReadModel({
      config: {
        ...DEFAULT_SPECTRA_CHART_CONFIG,
        wavelengthFocus: {
          ...DEFAULT_SPECTRA_CHART_CONFIG.wavelengthFocus,
          edgeMask: {
            enabled: true,
            start: 2,
            end: 2,
          },
        },
        filters: {
          ...DEFAULT_SPECTRA_CHART_CONFIG.filters,
          qcStatus: 'rejected',
        },
      },
      wavelengthRange: [950, 1650],
      wavelengthUnitSuffix: ' nm',
      yRange: [10, 20],
      metadataColumns: ['batch', 'site', 'instrument', 'operator'],
    });

    expect(readModel).toEqual({
      modifiedCount: 2,
      focusModifiedCount: 1,
      filterModifiedCount: 1,
      wavelengthRangeLabels: {
        start: '950 nm',
        end: '1650 nm',
      },
      targetRangeLabels: {
        start: '10.00',
        end: '20.00',
      },
      metadataPreviewText: 'Coming soon: Filter by batch, site +2 more',
    });
  });
});
