export interface PngCaptureInput {
  element?: HTMLElement | null;
  canvasElement?: HTMLCanvasElement | null;
}

export interface SvgCaptureInput {
  element?: HTMLElement | null;
  svgElement?: SVGElement | null;
}

export interface PngBlobOptions {
  quality?: number;
  scale?: number;
}

export async function createPngExportBlob(
  input: PngCaptureInput,
  options: PngBlobOptions = {}
): Promise<Blob | null> {
  const canvas = input.canvasElement ?? (
    input.element ? await elementToCanvas(input.element, options.scale ?? 2) : null
  );
  if (!canvas) {
    return null;
  }

  return canvasToPngBlob(canvas, options.quality ?? 0.95);
}

export async function canvasToPngBlob(
  canvas: HTMLCanvasElement,
  quality = 0.95
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Failed to create blob'));
      },
      'image/png',
      quality
    );
  });
}

export function findSvgElement(input: SvgCaptureInput): SVGElement | null {
  return input.svgElement ?? input.element?.querySelector('svg') ?? null;
}

export function serializeChartSvg(input: SvgCaptureInput): string | null {
  const svg = findSvgElement(input);
  if (!svg) {
    return null;
  }

  return serializeSvgElement(svg);
}

export function serializeSvgElement(svg: SVGElement): string {
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  const serializer = new XMLSerializer();
  return serializer.serializeToString(clone);
}

export async function elementToCanvas(
  element: HTMLElement,
  scale = 2
): Promise<HTMLCanvasElement> {
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

  ctx.scale(scale, scale);

  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.margin = '0';
  clone.style.position = 'absolute';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${rect.width}px;height:${rect.height}px">
          ${clone.outerHTML}
        </div>
      </foreignObject>
    </svg>
  `;

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
