import {
  buildCanvasScatterSpatialGrid,
  CANVAS_SCATTER_MARGIN,
  formatCanvasScatterTickValue,
  projectCanvasScatterPoints,
} from '@/lib/inspector/canvasScatterData';
import type {
  CanvasAnnotation,
  CanvasReferenceLine,
  CanvasScatterPoint,
  CanvasScatterSpatialGrid,
} from '@/lib/inspector/canvasScatterData';

interface CanvasScatterDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface RenderCanvasScatterSceneInput {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  points: CanvasScatterPoint[];
  referenceLines: CanvasReferenceLine[];
  annotations: CanvasAnnotation[];
  xTicks: number[];
  yTicks: number[];
  domain: CanvasScatterDomain;
  xLabel?: string;
  yLabel?: string;
  showGrid: boolean;
  hoveredIdx: number | null;
  screenPositions: Float64Array;
  devicePixelRatio: number;
}

interface RenderCanvasScatterSceneResult {
  rendered: boolean;
  screenPositions: Float64Array;
  spatialGrid: CanvasScatterSpatialGrid | null;
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  xTicks: number[],
  yTicks: number[],
  plotW: number,
  plotH: number,
  domain: CanvasScatterDomain,
  dpr: number,
) {
  ctx.save();
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.15)';
  ctx.lineWidth = dpr;

  const toScreenX = (v: number) => ((v - domain.xMin) / (domain.xMax - domain.xMin)) * plotW;
  const toScreenY = (v: number) => plotH - ((v - domain.yMin) / (domain.yMax - domain.yMin)) * plotH;

  for (const tick of xTicks) {
    const x = toScreenX(tick);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, plotH);
    ctx.stroke();
  }

  for (const tick of yTicks) {
    const y = toScreenY(tick);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotW, y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  xTicks: number[],
  yTicks: number[],
  plotW: number,
  plotH: number,
  domain: CanvasScatterDomain,
  dpr: number,
  xLabel?: string,
  yLabel?: string,
) {
  ctx.save();
  const fontSize = 10 * dpr;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const toScreenX = (v: number) => ((v - domain.xMin) / (domain.xMax - domain.xMin)) * plotW;
  const toScreenY = (v: number) => plotH - ((v - domain.yMin) / (domain.yMax - domain.yMin)) * plotH;

  for (const tick of xTicks) {
    const x = toScreenX(tick);
    ctx.fillText(formatCanvasScatterTickValue(tick), x, plotH + 4 * dpr);
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const tick of yTicks) {
    const y = toScreenY(tick);
    ctx.fillText(formatCanvasScatterTickValue(tick), -6 * dpr, y);
  }

  if (xLabel) {
    const labelSize = 11 * dpr;
    ctx.font = `${labelSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(xLabel, plotW / 2, plotH + 22 * dpr);
  }

  if (yLabel) {
    const labelSize = 11 * dpr;
    ctx.font = `${labelSize}px sans-serif`;
    ctx.save();
    ctx.translate(-40 * dpr, plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

function drawReferenceLines(
  ctx: CanvasRenderingContext2D,
  lines: CanvasReferenceLine[],
  plotW: number,
  plotH: number,
  domain: CanvasScatterDomain,
  dpr: number,
) {
  const toScreenX = (v: number) => ((v - domain.xMin) / (domain.xMax - domain.xMin)) * plotW;
  const toScreenY = (v: number) => plotH - ((v - domain.yMin) / (domain.yMax - domain.yMin)) * plotH;

  for (const line of lines) {
    ctx.save();
    ctx.strokeStyle = line.color;
    ctx.lineWidth = (line.width ?? 1) * dpr;
    if (line.dash) ctx.setLineDash(line.dash.map(d => d * dpr));

    ctx.beginPath();
    switch (line.type) {
      case 'y-equals-x': {
        const start = Math.max(domain.xMin, domain.yMin);
        const end = Math.min(domain.xMax, domain.yMax);
        ctx.moveTo(toScreenX(start), toScreenY(start));
        ctx.lineTo(toScreenX(end), toScreenY(end));
        break;
      }
      case 'horizontal': {
        const y = toScreenY(line.value ?? 0);
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        break;
      }
      case 'vertical': {
        const x = toScreenX(line.value ?? 0);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, plotH);
        break;
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  screenPositions: Float64Array,
  points: CanvasScatterPoint[],
  hoveredIdx: number | null,
  dpr: number,
) {
  for (let i = 0; i < points.length; i++) {
    if (i === hoveredIdx) continue;
    const p = points[i];
    const sx = screenPositions[i * 2];
    const sy = screenPositions[i * 2 + 1];
    const r = p.radius * dpr;

    ctx.globalAlpha = p.opacity;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (hoveredIdx !== null && hoveredIdx < points.length) {
    const p = points[hoveredIdx];
    const sx = screenPositions[hoveredIdx * 2];
    const sy = screenPositions[hoveredIdx * 2 + 1];
    const r = (p.radius + 2) * dpr;

    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(sx, sy, r + dpr, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: CanvasAnnotation[],
  plotW: number,
  plotH: number,
  dpr: number,
) {
  const fontSize = 10 * dpr;
  ctx.font = `${fontSize}px sans-serif`;

  for (const ann of annotations) {
    let x: number;
    let y: number;
    switch (ann.position) {
      case 'top-left':
        x = 4 * dpr;
        y = 4 * dpr;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        break;
      case 'top-right':
        x = plotW - 4 * dpr;
        y = 4 * dpr;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        break;
      case 'bottom-left':
        x = 4 * dpr;
        y = plotH - 4 * dpr;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        break;
      case 'bottom-right':
        x = plotW - 4 * dpr;
        y = plotH - 4 * dpr;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        break;
    }

    const metrics = ctx.measureText(ann.text);
    const pad = 3 * dpr;
    const bgX = ctx.textAlign === 'right' ? x - metrics.width - pad : x - pad;
    const bgY = ctx.textBaseline === 'bottom' ? y - fontSize - pad : y - pad;

    ctx.fillStyle = 'rgba(var(--card), 0.85)';
    ctx.fillRect(bgX, bgY, metrics.width + pad * 2, fontSize + pad * 2);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.fillText(ann.text, x, y);
  }
}

export function renderCanvasScatterScene({
  canvas,
  container,
  points,
  referenceLines,
  annotations,
  xTicks,
  yTicks,
  domain,
  xLabel,
  yLabel,
  showGrid,
  hoveredIdx,
  screenPositions,
  devicePixelRatio,
}: RenderCanvasScatterSceneInput): RenderCanvasScatterSceneResult {
  const rect = container.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio, 2);
  const w = Math.floor(rect.width * dpr);
  const h = Math.floor(rect.height * dpr);

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    return { rendered: false, screenPositions, spatialGrid: null };
  }

  ctx.fillStyle = 'rgb(var(--card))';
  ctx.fillRect(0, 0, w, h);

  const mTop = CANVAS_SCATTER_MARGIN.top * dpr;
  const mRight = CANVAS_SCATTER_MARGIN.right * dpr;
  const mBottom = CANVAS_SCATTER_MARGIN.bottom * dpr;
  const mLeft = CANVAS_SCATTER_MARGIN.left * dpr;
  const plotW = w - mLeft - mRight;
  const plotH = h - mTop - mBottom;

  if (plotW <= 0 || plotH <= 0) {
    return { rendered: false, screenPositions, spatialGrid: null };
  }

  ctx.save();
  ctx.translate(mLeft, mTop);

  ctx.strokeStyle = 'rgba(128, 128, 128, 0.2)';
  ctx.lineWidth = dpr;
  ctx.strokeRect(0, 0, plotW, plotH);

  if (showGrid) {
    drawGrid(ctx, xTicks, yTicks, plotW, plotH, domain, dpr);
  }

  if (referenceLines.length > 0) {
    drawReferenceLines(ctx, referenceLines, plotW, plotH, domain, dpr);
  }

  const nextScreenPositions = projectCanvasScatterPoints({
    points,
    plotW,
    plotH,
    xMin: domain.xMin,
    xMax: domain.xMax,
    yMin: domain.yMin,
    yMax: domain.yMax,
    target: screenPositions,
  });
  const spatialGrid = buildCanvasScatterSpatialGrid(nextScreenPositions, points.length, 12 * dpr);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, plotW, plotH);
  ctx.clip();
  drawPoints(ctx, nextScreenPositions, points, hoveredIdx, dpr);
  ctx.restore();

  if (annotations.length > 0) {
    drawAnnotations(ctx, annotations, plotW, plotH, dpr);
  }

  drawAxes(ctx, xTicks, yTicks, plotW, plotH, domain, dpr, xLabel, yLabel);

  ctx.restore();

  return {
    rendered: true,
    screenPositions: nextScreenPositions,
    spatialGrid,
  };
}
