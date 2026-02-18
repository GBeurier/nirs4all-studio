/**
 * CandlestickChart — Box-and-whisker plot of score distribution by category.
 *
 * Each category shows: min, Q25, median, Q75, max (box-whisker) and outlier dots.
 * Custom SVG rendering within a container for precise control.
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import { useInspectorColor } from '@/context/InspectorColorContext';
import type { CandlestickResponse, CandlestickCategory } from '@/types/inspector';

interface CandlestickChartProps {
  data: CandlestickResponse | null | undefined;
  isLoading: boolean;
}

interface HoveredBox {
  category: CandlestickCategory;
  mouseX: number;
  mouseY: number;
}

export function CandlestickChart({ data, isLoading }: CandlestickChartProps) {
  const { select } = useInspectorSelection();
  const { config } = useInspectorColor();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredBox | null>(null);
  const [dims, setDims] = useState({ width: 600, height: 400 });

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setDims({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Compute y-axis scale from data
  const { yMin, yMax, categories } = useMemo(() => {
    if (!data?.categories?.length) return { yMin: 0, yMax: 1, categories: [] };
    let min = Infinity;
    let max = -Infinity;
    for (const cat of data.categories) {
      if (cat.min < min) min = cat.min;
      if (cat.max > max) max = cat.max;
      for (const o of cat.outlier_values) {
        if (o < min) min = o;
        if (o > max) max = o;
      }
    }
    const range = max - min || 1;
    return { yMin: min - range * 0.05, yMax: max + range * 0.05, categories: data.categories };
  }, [data]);

  const handleBoxClick = useCallback((chainIds: string[]) => {
    if (chainIds.length > 0) select(chainIds, 'toggle');
  }, [select]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading box plot data...</span>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No box plot data available.
      </div>
    );
  }

  const marginLeft = 55;
  const marginRight = 15;
  const marginTop = 15;
  const marginBottom = 80;
  const plotW = dims.width - marginLeft - marginRight;
  const plotH = dims.height - marginTop - marginBottom;
  const yRange = yMax - yMin || 1;

  const scaleY = (v: number) => marginTop + plotH - ((v - yMin) / yRange) * plotH;

  const catCount = categories.length;
  const catWidth = plotW / catCount;
  const boxWidth = Math.min(catWidth * 0.6, 50);

  // Y-axis ticks
  const tickCount = 5;
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i++) {
    ticks.push(yMin + (yRange * i) / tickCount);
  }

  // Palette colors
  const COLORS = [
    '#0d9488', '#2563eb', '#d97706', '#e11d48', '#7c3aed',
    '#059669', '#ea580c', '#0284c7', '#db2777', '#65a30d',
  ];

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg width={dims.width} height={dims.height} className="select-none">
        {/* Y-axis grid lines and labels */}
        {ticks.map((tick, i) => (
          <g key={i}>
            <line
              x1={marginLeft}
              x2={dims.width - marginRight}
              y1={scaleY(tick)}
              y2={scaleY(tick)}
              stroke="#334155"
              strokeDasharray="3 3"
              opacity={0.4}
            />
            <text
              x={marginLeft - 6}
              y={scaleY(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {tick.toFixed(3)}
            </text>
          </g>
        ))}

        {/* Boxes */}
        {categories.map((cat, ci) => {
          const cx = marginLeft + ci * catWidth + catWidth / 2;
          const color = COLORS[ci % COLORS.length];
          const isHovered = hovered?.category.label === cat.label;

          const y_q25 = scaleY(cat.q25);
          const y_q75 = scaleY(cat.q75);
          const y_median = scaleY(cat.median);
          const y_min = scaleY(cat.min);
          const y_max = scaleY(cat.max);

          return (
            <g key={cat.label} cursor="pointer" onClick={() => handleBoxClick(cat.chain_ids)}>
              {/* Whisker line (min to max) */}
              <line x1={cx} x2={cx} y1={y_min} y2={y_max} stroke={color} strokeWidth={1.5} opacity={0.6} />

              {/* Min cap */}
              <line x1={cx - boxWidth * 0.3} x2={cx + boxWidth * 0.3} y1={y_min} y2={y_min} stroke={color} strokeWidth={1.5} />

              {/* Max cap */}
              <line x1={cx - boxWidth * 0.3} x2={cx + boxWidth * 0.3} y1={y_max} y2={y_max} stroke={color} strokeWidth={1.5} />

              {/* IQR Box (Q25 to Q75) */}
              <rect
                x={cx - boxWidth / 2}
                y={Math.min(y_q25, y_q75)}
                width={boxWidth}
                height={Math.abs(y_q75 - y_q25)}
                fill={color}
                fillOpacity={isHovered ? 0.5 : 0.3}
                stroke={color}
                strokeWidth={isHovered ? 2 : 1.5}
                rx={2}
                onMouseEnter={(e) => setHovered({ category: cat, mouseX: e.clientX, mouseY: e.clientY })}
                onMouseLeave={() => setHovered(null)}
              />

              {/* Median line */}
              <line
                x1={cx - boxWidth / 2}
                x2={cx + boxWidth / 2}
                y1={y_median}
                y2={y_median}
                stroke={color}
                strokeWidth={2.5}
              />

              {/* Outlier dots */}
              {cat.outlier_values.map((ov, oi) => (
                <circle
                  key={oi}
                  cx={cx}
                  cy={scaleY(ov)}
                  r={3}
                  fill={color}
                  fillOpacity={0.6}
                  stroke={color}
                  strokeWidth={1}
                />
              ))}

              {/* Category label */}
              <text
                x={cx}
                y={dims.height - marginBottom + 10}
                textAnchor="end"
                dominantBaseline="hanging"
                className="fill-muted-foreground"
                fontSize={10}
                transform={`rotate(-40, ${cx}, ${dims.height - marginBottom + 10})`}
              >
                {cat.label.length > 20 ? cat.label.slice(0, 18) + '…' : cat.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border pointer-events-none"
          style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 60 }}
        >
          <div className="font-medium">{hovered.category.label}</div>
          <div>Min: {hovered.category.min.toFixed(4)}</div>
          <div>Q25: {hovered.category.q25.toFixed(4)}</div>
          <div>Median: {hovered.category.median.toFixed(4)}</div>
          <div>Mean: {hovered.category.mean.toFixed(4)}</div>
          <div>Q75: {hovered.category.q75.toFixed(4)}</div>
          <div>Max: {hovered.category.max.toFixed(4)}</div>
          <div>IQR: {(hovered.category.q75 - hovered.category.q25).toFixed(4)}</div>
          <div>n = {hovered.category.count}</div>
        </div>
      )}
    </div>
  );
}
