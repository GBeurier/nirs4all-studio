import { describe, expect, it } from "vitest";

import {
  formatWavelengthUnit,
  getWavelengthAxisLabel,
  getWavelengthAxisName,
} from "./chartConfig";

// Characterization of the unit-aware axis helpers shared by the dataset and
// spectra-synthesis SpectraChart components (FE-07-reg dedupe). These pin the
// nm/cm-1/µm/fallback behaviour both charts now route their axis labels through.

describe("formatWavelengthUnit", () => {
  it("normalizes wavenumber aliases to cm⁻¹", () => {
    for (const u of ["cm-1", "cm^-1", "cm⁻¹", "wavenumber", "CM-1"]) {
      expect(formatWavelengthUnit(u)).toBe("cm⁻¹");
    }
  });

  it("normalizes nanometer aliases to nm", () => {
    for (const u of ["nm", "nanometer", "Nanometers"]) {
      expect(formatWavelengthUnit(u)).toBe("nm");
    }
  });

  it("returns an empty string for index/none/text/missing units", () => {
    expect(formatWavelengthUnit(undefined)).toBe("");
    expect(formatWavelengthUnit(null)).toBe("");
    expect(formatWavelengthUnit("index")).toBe("");
    expect(formatWavelengthUnit("none")).toBe("");
  });
});

describe("getWavelengthAxisLabel", () => {
  it("labels nm as Wavelength and cm-1 as Wavenumber", () => {
    expect(getWavelengthAxisLabel("nm")).toBe("Wavelength (nm)");
    expect(getWavelengthAxisLabel("cm-1")).toBe("Wavenumber (cm⁻¹)");
    expect(getWavelengthAxisLabel("um")).toBe("Wavelength (µm)");
  });

  it("falls back to a bare Wavelength label when the unit is unknown/missing", () => {
    expect(getWavelengthAxisLabel(undefined)).toBe("Wavelength");
    expect(getWavelengthAxisLabel("index")).toBe("Wavelength");
  });
});

describe("getWavelengthAxisName", () => {
  it("returns Wavenumber only for cm-1, Wavelength otherwise", () => {
    expect(getWavelengthAxisName("cm-1")).toBe("Wavenumber");
    expect(getWavelengthAxisName("nm")).toBe("Wavelength");
    expect(getWavelengthAxisName(undefined)).toBe("Wavelength");
  });
});
