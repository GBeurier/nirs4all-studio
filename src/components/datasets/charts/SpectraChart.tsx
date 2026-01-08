/**
 * SpectraChart - SVG-based spectral visualization component
 *
 * Displays mean spectrum with optional min/max range shading.
 * Used in dataset previews and quick views.
 */

export interface SpectraChartProps {
  /** Array of wavelength values for the x-axis */
  wavelengths: number[];
  /** Mean spectrum values */
  meanSpectrum: number[];
  /** Standard deviation values (optional) */
  stdSpectrum?: number[];
  /** Minimum spectrum values for range display (optional) */
  minSpectrum?: number[];
  /** Maximum spectrum values for range display (optional) */
  maxSpectrum?: number[];
  /** Chart width (default: 400) */
  width?: number;
  /** Chart height (default: 200) */
  height?: number;
  /** X-axis label (default: "Wavelength") */
  xLabel?: string;
  /** Y-axis label (default: none) */
  yLabel?: string;
  /** Show axis labels (default: true) */
  showLabels?: boolean;
}

export function SpectraChart({
  wavelengths,
  meanSpectrum,
  stdSpectrum,
  minSpectrum,
  maxSpectrum,
  width = 400,
  height = 200,
  xLabel = "Wavelength",
  yLabel,
  showLabels = true,
}: SpectraChartProps) {
  // Calculate chart dimensions
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Handle empty data
  if (!wavelengths.length || !meanSpectrum.length) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-sm"
        style={{ width, height }}
      >
        No spectra data available
      </div>
    );
  }

  // Scale functions
  const xMin = Math.min(...wavelengths);
  const xMax = Math.max(...wavelengths);
  const allValues = [
    ...meanSpectrum,
    ...(minSpectrum || []),
    ...(maxSpectrum || []),
  ];
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yRange = yMax - yMin || 1;

  const scaleX = (x: number) =>
    padding.left + ((x - xMin) / (xMax - xMin || 1)) * chartWidth;
  const scaleY = (y: number) =>
    padding.top + chartHeight - ((y - yMin) / yRange) * chartHeight;

  // Create path for mean spectrum
  const meanPath = meanSpectrum
    .map((y, i) => `${i === 0 ? "M" : "L"} ${scaleX(wavelengths[i])} ${scaleY(y)}`)
    .join(" ");

  // Create area for min-max range
  let rangePath = "";
  if (minSpectrum && maxSpectrum) {
    const upper = maxSpectrum
      .map((y, i) => `${i === 0 ? "M" : "L"} ${scaleX(wavelengths[i])} ${scaleY(y)}`)
      .join(" ");
    const lower = [...minSpectrum]
      .reverse()
      .map(
        (y, i) =>
          `L ${scaleX(wavelengths[wavelengths.length - 1 - i])} ${scaleY(y)}`
      )
      .join(" ");
    rangePath = `${upper} ${lower} Z`;
  }

  return (
    <svg width={width} height={height} className="w-full h-auto">
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((t) => (
        <line
          key={t}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + chartHeight * t}
          y2={padding.top + chartHeight * t}
          stroke="currentColor"
          strokeOpacity={0.1}
        />
      ))}

      {/* Range area */}
      {rangePath && (
        <path
          d={rangePath}
          fill="hsl(var(--primary))"
          fillOpacity={0.1}
          stroke="none"
        />
      )}

      {/* Mean line */}
      <path
        d={meanPath}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth={2}
      />

      {/* X-axis */}
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={height - padding.bottom}
        y2={height - padding.bottom}
        stroke="currentColor"
        strokeOpacity={0.3}
      />
      {showLabels && xLabel && (
        <text
          x={width / 2}
          y={height - 5}
          textAnchor="middle"
          className="text-xs fill-muted-foreground"
        >
          {xLabel}
        </text>
      )}

      {/* Y-axis */}
      <line
        x1={padding.left}
        x2={padding.left}
        y1={padding.top}
        y2={height - padding.bottom}
        stroke="currentColor"
        strokeOpacity={0.3}
      />
      {showLabels && yLabel && (
        <text
          x={15}
          y={height / 2}
          textAnchor="middle"
          className="text-xs fill-muted-foreground"
          transform={`rotate(-90, 15, ${height / 2})`}
        >
          {yLabel}
        </text>
      )}
    </svg>
  );
}
