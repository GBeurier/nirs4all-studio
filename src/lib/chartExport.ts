// Export chart as PNG
export async function exportChartAsPNG(
  containerRef: HTMLDivElement | null,
  filename: string
): Promise<void> {
  if (!containerRef) return;

  const svg = containerRef.querySelector('svg');
  if (!svg) return;

  const svgData = new XMLSerializer().serializeToString(svg);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = new Image();
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve) => {
    img.onload = () => {
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      ctx.scale(2, 2);
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      const link = document.createElement('a');
      link.download = `${filename}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();

      URL.revokeObjectURL(url);
      resolve();
    };
    img.src = url;
  });
}

// Export data as CSV
export function exportDataAsCSV(
  data: Record<string, number | string>[],
  filename: string
): void {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => headers.map(h => row[h]).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.click();
}

// Export both PNG and CSV
export async function exportChart(
  containerRef: HTMLDivElement | null,
  data: Record<string, number | string>[],
  filename: string
): Promise<void> {
  await exportChartAsPNG(containerRef, filename);
  exportDataAsCSV(data, `${filename}_data`);
}
