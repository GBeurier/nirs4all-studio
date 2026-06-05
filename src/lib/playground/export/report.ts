/**
 * Export System - Combined report export (Phase 8)
 */

import { downloadBlob, generateFilename } from './shared';
import type { ExportOptions, ExportResult } from './types';

export interface CombinedReportOptions extends ExportOptions {
  /** Dataset name for header */
  datasetName?: string;
  /** Pipeline description */
  pipelineDescription?: string;
  /** Statistics to show in footer */
  statistics?: {
    sampleCount?: number;
    wavelengthCount?: number;
    selectedCount?: number;
    outlierCount?: number;
    yRange?: { min: number; max: number };
  };
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

  // Check if element contains a canvas (WebGL charts)
  const sourceCanvas = element.querySelector('canvas');
  if (sourceCanvas) {
    // Direct canvas copy
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    return canvas;
  }

  // Check if element contains an SVG (Recharts)
  const svg = element.querySelector('svg');
  if (svg) {
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
 * ┌───────────────────────────────────────┐
 * │  Dataset: sample_data                 │  ← Header
 * │  Date: 2026-01-08                     │
 * ├───────────────┬───────────────────────┤
 * │               │                       │
 * │   Spectra     │      PCA/UMAP        │
 * │               │                       │
 * ├───────────────┼───────────────────────┤
 * │               │                       │
 * │  Histogram    │     Folds            │
 * │               │                       │
 * ├───────────────┴───────────────────────┤
 * │ Pipeline: SNV → Detrend → PLS(10)     │  ← Footer
 * │ Statistics: N=500, Y: 2.1-8.4         │
 * └───────────────────────────────────────┘
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

    // Layout constants
    const padding = 20;
    const headerHeight = 60;
    const footerHeight = 80;
    const chartAreaTop = headerHeight + padding;
    const chartAreaHeight = height - headerHeight - footerHeight - padding * 2;

    // Determine grid layout based on visible charts
    const visibleCharts = Array.from(chartElements.entries());
    const chartCount = visibleCharts.length;

    // Calculate grid dimensions
    let cols = 2;
    let rows = 2;
    if (chartCount === 1) {
      cols = 1;
      rows = 1;
    } else if (chartCount === 2) {
      cols = 2;
      rows = 1;
    } else if (chartCount === 3) {
      cols = 2;
      rows = 2;
    } else if (chartCount === 4) {
      cols = 2;
      rows = 2;
    } else {
      cols = 2;
      rows = Math.ceil(chartCount / 2);
    }

    const cellWidth = (width - padding * (cols + 1)) / cols;
    const cellHeight = Math.min(chartAreaHeight / rows - padding, cellWidth * 0.6);

    // Draw header
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(datasetName, padding, padding);

    ctx.fillStyle = '#666666';
    ctx.font = '14px system-ui, sans-serif';
    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    ctx.fillText(dateStr, padding, padding + 30);

    // Draw divider line
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, headerHeight);
    ctx.lineTo(width - padding, headerHeight);
    ctx.stroke();

    // Capture and draw each chart
    let chartIndex = 0;
    for (const [chartType, element] of visibleCharts) {
      const col = chartIndex % cols;
      const row = Math.floor(chartIndex / cols);

      const x = padding + col * (cellWidth + padding);
      const y = chartAreaTop + row * (cellHeight + padding);

      try {
        // Capture chart to image
        const chartCanvas = await captureElementToImage(element, 1.5);

        // Draw chart
        ctx.drawImage(chartCanvas, x, y, cellWidth, cellHeight);

        // Draw chart label
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 12px system-ui, sans-serif';
        const label = chartType.charAt(0).toUpperCase() + chartType.slice(1);
        ctx.fillText(label, x + 5, y + 5);

        // Draw border
        ctx.strokeStyle = '#e5e5e5';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cellWidth, cellHeight);
      } catch (error) {
        // Draw placeholder for failed chart
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(x, y, cellWidth, cellHeight);
        ctx.fillStyle = '#999999';
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`[${chartType}]`, x + cellWidth / 2, y + cellHeight / 2);
        ctx.textAlign = 'left';
      }

      chartIndex++;
    }

    // Draw footer
    const footerY = height - footerHeight;

    // Footer divider
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, footerY);
    ctx.lineTo(width - padding, footerY);
    ctx.stroke();

    // Pipeline description
    if (pipelineDescription) {
      ctx.fillStyle = '#333333';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(`Pipeline: ${pipelineDescription}`, padding, footerY + 15);
    }

    // Statistics
    if (statistics) {
      const statsParts: string[] = [];
      if (statistics.sampleCount !== undefined) {
        statsParts.push(`N = ${statistics.sampleCount}`);
      }
      if (statistics.wavelengthCount !== undefined) {
        statsParts.push(`Features = ${statistics.wavelengthCount}`);
      }
      if (statistics.selectedCount !== undefined && statistics.selectedCount > 0) {
        statsParts.push(`Selected = ${statistics.selectedCount}`);
      }
      if (statistics.outlierCount !== undefined && statistics.outlierCount > 0) {
        statsParts.push(`Outliers = ${statistics.outlierCount}`);
      }
      if (statistics.yRange) {
        statsParts.push(`Y range: ${statistics.yRange.min.toFixed(2)} - ${statistics.yRange.max.toFixed(2)}`);
      }

      if (statsParts.length > 0) {
        ctx.fillStyle = '#666666';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(statsParts.join(' | '), padding, footerY + 40);
      }
    }

    // Generated by footer
    ctx.fillStyle = '#999999';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Generated with nirs4all Playground', width - padding, footerY + 55);
    ctx.textAlign = 'left';

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
