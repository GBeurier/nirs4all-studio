import { describe, expect, it } from "vitest";

import { buildSpectraChartData } from "./SpectraChart";

describe("buildSpectraChartData", () => {
  it("returns one row per wavelength with mean and no range when min/max are absent", () => {
    expect(buildSpectraChartData([400, 410], [1, 2])).toEqual([
      { wavelength: 400, mean: 1 },
      { wavelength: 410, mean: 2 },
    ]);
  });

  it("attaches a [min, max] range tuple per row when both min and max are supplied", () => {
    expect(
      buildSpectraChartData([400, 410], [1, 2], [0.5, 1.5], [1.5, 2.5]),
    ).toEqual([
      { wavelength: 400, mean: 1, range: [0.5, 1.5] },
      { wavelength: 410, mean: 2, range: [1.5, 2.5] },
    ]);
  });

  it("omits the range when only one of min/max is supplied", () => {
    expect(buildSpectraChartData([400], [1], [0.5])).toEqual([{ wavelength: 400, mean: 1 }]);
    expect(buildSpectraChartData([400], [1], undefined, [1.5])).toEqual([
      { wavelength: 400, mean: 1 },
    ]);
  });

  it("returns an empty array for empty wavelengths or mean spectrum", () => {
    expect(buildSpectraChartData([], [])).toEqual([]);
    expect(buildSpectraChartData([400], [])).toEqual([]);
  });
});
