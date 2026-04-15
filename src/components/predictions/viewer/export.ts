/**
 * Export helpers (CSV + PNG) for the prediction chart viewer.
 *
 * Adapted from PredictionQuickView.tsx. PNG export accepts an optional
 * backgroundColor so callers can honor the user's exportTheme preference.
 */

export function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function sanitizeFilename(value: string | null | undefined): string {
  return (value || "chart").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/** Render the rows as CSV and download them as a file. */
export function exportRowsCsv<T extends Record<string, unknown>>(
  rows: T[],
  header: (keyof T)[],
  filename: string,
): void {
  const headerLine = header.map((c) => csvEscape(String(c))).join(",");
  const lines = rows.map((row) => header.map((col) => csvEscape(row[col])).join(","));
  const csv = [headerLine, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename);
}

/**
 * Serialize the first SVG inside `container` to PNG via canvas and download it.
 *
 * @param backgroundColor Optional explicit canvas background (default "#ffffff").
 *   Callers pass the resolved exportTheme color.
 */
export function exportChartPng(
  container: HTMLElement | null,
  filename: string,
  backgroundColor: string = "#ffffff",
): void {
  if (!container) return;
  const svg = container.querySelector("svg");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(rect.width));
  clone.setAttribute("height", String(rect.height));
  const xml = new XMLSerializer().serializeToString(clone);
  const svg64 = btoa(unescape(encodeURIComponent(xml)));
  const image64 = `data:image/svg+xml;base64,${svg64}`;
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename);
    }, "image/png");
  };
  img.src = image64;
}

/** Resolve an export-theme selection to a concrete canvas background color. */
export function resolveExportBackground(theme: "inherit" | "light" | "dark"): string {
  if (theme === "dark") return "#0b1220";
  if (theme === "light") return "#ffffff";
  // Inherit → sniff the document.
  if (typeof document !== "undefined") {
    const isDark = document.documentElement.classList.contains("dark");
    return isDark ? "#0b1220" : "#ffffff";
  }
  return "#ffffff";
}
