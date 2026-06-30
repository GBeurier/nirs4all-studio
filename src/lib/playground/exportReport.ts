import type { ExportOptions, ExportResult } from '@/lib/playground/export';
import { detectCaptureSource } from '@/lib/playground/exportCapture';
import { finalizeBlobExport, toExportError } from '@/lib/playground/exportResult';
import {
  buildCombinedReportChartPlacements,
  buildCombinedReportGrid,
  formatCombinedReportDate,
  type CombinedReportStatistics,
} from '@/lib/playground/exportReportLayout';
import {
  drawCombinedReportChartFrame,
  drawCombinedReportChartPlaceholder,
  drawCombinedReportFooter,
  drawCombinedReportHeader,
} from '@/lib/playground/exportReportDrawing';

export interface CombinedReportOptions extends ExportOptions {
  /** Dataset name for header */
  datasetName?: string;
  /** Pipeline description */
  pipelineDescription?: string;
  /** Statistics to show in footer */
  statistics?: CombinedReportStatistics;
  /** Report dimensions (pixels) */
  width?: number;
  height?: number;
  /** Background color */
  backgroundColor?: string;
}

/**
 * Capture an HTML element to an image using html-to-image
 * Falls back to canvas-based approach if needed
 */
async function captureElementToImage(
  element: HTMLElement,
  scale = 2
): Promise<HTMLCanvasElement> {
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(rect.width * scale);
  const height = Math.ceil(rect.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  const source = detectCaptureSource(element);

  // WebGL charts render into a canvas we can copy directly
  if (source.kind === 'canvas') {
    ctx.drawImage(source.canvas, 0, 0, width, height);
    return canvas;
  }

  // Recharts render an SVG we serialize and rasterize
  if (source.kind === 'svg') {
    const svg = source.svg;
    // Clone SVG and serialize
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(rect.width));
    clone.setAttribute('height', String(rect.height));

    // Inline computed styles
    const originalElements = svg.querySelectorAll('*');
    const cloneElements = clone.querySelectorAll('*');
    for (let i = 0; i < originalElements.length; i++) {
      const computed = window.getComputedStyle(originalElements[i]);
      const cloneEl = cloneElements[i] as HTMLElement;
      if (cloneEl.style) {
        cloneEl.style.fill = computed.fill;
        cloneEl.style.stroke = computed.stroke;
        cloneEl.style.strokeWidth = computed.strokeWidth;
        cloneEl.style.opacity = computed.opacity;
      }
    }

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG image'));
      };
      img.src = url;
    });

    return canvas;
  }

  // Fallback: Create a white canvas
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#666666';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Unable to capture chart', width / 2, height / 2);

  return canvas;
}

/**
 * Export combined report with all visible charts
 *
 * Layout:
 * - Header with dataset name and date
 * - Grid of visible chart captures
 * - Footer with pipeline description and statistics
 */
export async function exportCombinedReport(
  chartElements: Map<string, HTMLElement>,
  options: CombinedReportOptions = {}
): Promise<ExportResult> {
  const {
    filename = 'playground-report',
    includeTimestamp = true,
    datasetName = 'Playground Data',
    pipelineDescription,
    statistics,
    width = 1600,
    height = 1200,
    backgroundColor = '#ffffff',
  } = options;

  try {
    // Create main canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create canvas context');
    }

    // Fill background
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    const padding = 20;
    const headerHeight = 60;
    const footerHeight = 80;
    const visibleCharts = Array.from(chartElements.entries());
    const {
      chartAreaTop,
      cols,
      cellWidth,
      cellHeight,
    } = buildCombinedReportGrid({
      chartCount: visibleCharts.length,
      width,
      height,
      padding,
      headerHeight,
      footerHeight,
    });

    drawCombinedReportHeader(ctx, {
      datasetName,
      dateText: formatCombinedReportDate(),
      padding,
      headerHeight,
      width,
    });

    // Capture and draw each chart
    const placements = buildCombinedReportChartPlacements({
      chartCount: visibleCharts.length,
      cols,
      cellWidth,
      cellHeight,
      chartAreaTop,
      padding,
    });
    for (const { index, x, y } of placements) {
      const [chartType, element] = visibleCharts[index];

      try {
        // Capture chart to image
        const chartCanvas = await captureElementToImage(element, 1.5);

        // Draw chart
        ctx.drawImage(chartCanvas, x, y, cellWidth, cellHeight);

        drawCombinedReportChartFrame(ctx, { chartType, x, y, cellWidth, cellHeight });
      } catch (error) {
        drawCombinedReportChartPlaceholder(ctx, { chartType, x, y, cellWidth, cellHeight });
      }
    }

    drawCombinedReportFooter(ctx, {
      height,
      footerHeight,
      width,
      padding,
      pipelineDescription,
      statistics,
    });

    // Convert to blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob'));
        },
        'image/png',
        0.95
      );
    });

    // Download
    return finalizeBlobExport(blob, filename, 'png', includeTimestamp);
  } catch (error) {
    return toExportError(error, 'png');
  }
}
