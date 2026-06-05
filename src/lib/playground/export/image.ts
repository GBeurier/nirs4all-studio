/**
 * Export System - Chart image export (PNG / SVG)
 */

import { MIME_TYPES, downloadBlob, generateFilename } from './shared';
import type { ChartExportData, ExportOptions, ExportResult } from './types';

/**
 * Convert HTML element to canvas using DOM rendering
 */
async function elementToCanvas(
  element: HTMLElement,
  scale = 2
): Promise<HTMLCanvasElement> {
  // Use html2canvas-like approach via SVG foreignObject
  const rect = element.getBoundingClientRect();
  const width = rect.width * scale;
  const height = rect.height * scale;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Scale for high DPI
  ctx.scale(scale, scale);

  // Clone element and serialize to SVG
  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.margin = '0';
  clone.style.position = 'absolute';

  // Create SVG with foreignObject
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${rect.width}px;height:${rect.height}px">
          ${clone.outerHTML}
        </div>
      </foreignObject>
    </svg>
  `;

  // Create image from SVG
  const img = new Image();
  const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
  const svgUrl = URL.createObjectURL(svgBlob);

  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(svgUrl);
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      reject(new Error('Failed to load SVG image'));
    };
    img.src = svgUrl;
  });

  return canvas;
}

// ============= PNG Export =============

/**
 * Export chart to PNG image
 */
export async function exportToPng(
  data: ChartExportData,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const {
    filename = `chart-${data.chartType}`,
    includeTimestamp = true,
    quality = 0.95,
    scale = 2,
  } = options;

  try {
    let canvas: HTMLCanvasElement;

    // If we have a canvas element, use it directly
    if (data.canvasElement) {
      canvas = data.canvasElement;
    } else if (data.element) {
      // Convert element to canvas
      canvas = await elementToCanvas(data.element, scale);
    } else {
      return {
        success: false,
        error: 'No element or canvas provided for export',
        format: 'png',
      };
    }

    // Convert to blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob'));
        },
        'image/png',
        quality
      );
    });

    // Download
    const finalFilename = generateFilename(filename, 'png', includeTimestamp);
    downloadBlob(blob, finalFilename);

    return {
      success: true,
      filename: finalFilename,
      format: 'png',
      size: blob.size,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
      format: 'png',
    };
  }
}

// ============= SVG Export =============

/**
 * Export chart to SVG
 */
export function exportToSvg(
  data: ChartExportData,
  options: ExportOptions = {}
): ExportResult {
  const {
    filename = `chart-${data.chartType}`,
    includeTimestamp = true,
  } = options;

  try {
    // Find SVG element
    let svg: SVGElement | null = data.svgElement ?? null;

    if (!svg && data.element) {
      svg = data.element.querySelector('svg');
    }

    if (!svg) {
      return {
        success: false,
        error: 'No SVG element found for export',
        format: 'svg',
      };
    }

    // Clone and prepare SVG
    const clone = svg.cloneNode(true) as SVGElement;

    // Add XML declaration and namespace
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    // Serialize to string
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);

    // Create blob and download
    const blob = new Blob([svgString], { type: MIME_TYPES.svg });
    const finalFilename = generateFilename(filename, 'svg', includeTimestamp);
    downloadBlob(blob, finalFilename);

    return {
      success: true,
      filename: finalFilename,
      format: 'svg',
      size: blob.size,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
      format: 'svg',
    };
  }
}
