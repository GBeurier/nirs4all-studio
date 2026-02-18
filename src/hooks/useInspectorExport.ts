/**
 * useInspectorExport — Export hook for Inspector panels.
 *
 * Provides PNG export of individual panels (using data-panel-type attribute)
 * and CSV export of chain data.
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useInspectorData } from '@/context/InspectorDataContext';
import { useInspectorView } from '@/context/InspectorViewContext';
import { INSPECTOR_PANELS } from '@/lib/inspector/chartRegistry';
import type { InspectorPanelType } from '@/types/inspector';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function timestampStr(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function elementToCanvas(element: HTMLElement, scale = 2): Promise<HTMLCanvasElement> {
  const rect = element.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = rect.width * scale;
  canvas.height = rect.height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // Render SVGs within the element
  const svgs = element.querySelectorAll('svg');
  for (const svg of svgs) {
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = svgUrl;
    });
    const svgRect = svg.getBoundingClientRect();
    ctx.drawImage(img, svgRect.left - rect.left, svgRect.top - rect.top, svgRect.width, svgRect.height);
    URL.revokeObjectURL(svgUrl);
  }

  // Render Recharts canvases (if any)
  const canvases = element.querySelectorAll('canvas');
  for (const c of canvases) {
    const cRect = c.getBoundingClientRect();
    ctx.drawImage(c, cRect.left - rect.left, cRect.top - rect.top, cRect.width, cRect.height);
  }

  return canvas;
}

export function useInspectorExport() {
  const { chains, scoreColumn, filters } = useInspectorData();
  const { isPanelVisible } = useInspectorView();

  const exportPanelAsPng = useCallback(async (panelType: InspectorPanelType) => {
    const el = document.querySelector<HTMLElement>(`[data-panel-type="${panelType}"]`);
    if (!el) {
      toast.error(`Panel "${panelType}" not found.`);
      return;
    }
    try {
      const canvas = await elementToCanvas(el);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Failed'))), 'image/png', 0.95);
      });
      const panelName = INSPECTOR_PANELS.find(p => p.id === panelType)?.shortName ?? panelType;
      downloadBlob(blob, `inspector-${panelName}-${timestampStr()}.png`);
      toast.success(`Exported ${panelName} as PNG`);
    } catch {
      toast.error(`Failed to export panel as PNG.`);
    }
  }, []);

  const exportAllVisiblePanelsPng = useCallback(async () => {
    const visiblePanels = INSPECTOR_PANELS.filter(p => isPanelVisible(p.id));
    if (visiblePanels.length === 0) {
      toast.error('No visible panels to export.');
      return;
    }
    let exported = 0;
    for (const panel of visiblePanels) {
      const el = document.querySelector<HTMLElement>(`[data-panel-type="${panel.id}"]`);
      if (!el) continue;
      try {
        const canvas = await elementToCanvas(el);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Failed'))), 'image/png', 0.95);
        });
        downloadBlob(blob, `inspector-${panel.shortName}-${timestampStr()}.png`);
        exported++;
      } catch {
        // Skip failed panels
      }
    }
    if (exported > 0) {
      toast.success(`Exported ${exported} panels as PNG`);
    } else {
      toast.error('Failed to export any panels.');
    }
  }, [isPanelVisible]);

  const exportDataAsCsv = useCallback(() => {
    if (chains.length === 0) {
      toast.error('No chain data to export.');
      return;
    }

    const columns = [
      'chain_id', 'run_id', 'pipeline_id', 'model_class', 'model_name',
      'preprocessings', 'dataset_name', 'task_type', 'metric',
      'cv_val_score', 'cv_test_score', 'cv_train_score',
      'final_test_score', 'final_train_score', 'cv_fold_count',
    ];

    const header = columns.join(',');
    const rows = chains.map(chain =>
      columns.map(col => {
        const val = chain[col as keyof typeof chain];
        if (val == null) return '';
        const s = String(val);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }).join(','),
    );

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const prefix = filters.run_id ? `run-${filters.run_id}` : 'inspector';
    downloadBlob(blob, `${prefix}-chains-${timestampStr()}.csv`);
    toast.success(`Exported ${chains.length} chains as CSV`);
  }, [chains, filters]);

  return {
    exportPanelAsPng,
    exportAllVisiblePanelsPng,
    exportDataAsCsv,
  };
}
