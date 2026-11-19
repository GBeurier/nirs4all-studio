import { useState } from 'react';
import { Download } from 'lucide-react';
import { N4aExportSelection, type N4aExportOption } from 'nirs4all-ui/components';
import { requestBinary } from '@/api/transport';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface N4aExportSection extends N4aExportOption {
  payload: unknown | (() => unknown | Promise<unknown>);
}

/** Host-side IO around the shared controlled content selector. */
export function N4aExportButton({ sections, datasetId, bundlePath, shapJobId, filename = 'checkpoint', label = 'Export .n4a' }: {
  sections: N4aExportSection[];
  datasetId?: string;
  bundlePath?: string;
  shapJobId?: string;
  filename?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const values: Record<string, unknown> = {};
      for (const section of sections.filter(section => selected.includes(section.id) && !section.disabled)) {
        values[section.id] = typeof section.payload === 'function' ? await section.payload() : section.payload;
      }
      const blob = await requestBinary('/exports/n4a', 'POST', { sections: values, dataset_id: datasetId, bundle_path: bundlePath, shap_job_id: shapJobId });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}.n4a`;
      anchor.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };
  return <>
    <Button variant="outline" size="sm" onClick={() => {
      setSelected(sections.filter(section => !section.disabled).map(section => section.id));
      setError(null);
      setOpen(true);
    }}><Download className="mr-2 h-4 w-4" />{label}</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Export .n4a</DialogTitle><DialogDescription>Select the content to include. Source files keep their original bytes; analysis snapshots describe the displayed stage.</DialogDescription></DialogHeader>
        <N4aExportSelection options={sections} value={selected} onChange={setSelected} disabled={busy}
          className="space-y-3" optionClassName="flex gap-3 rounded border p-3 text-sm" />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button disabled={busy || selected.length === 0} onClick={() => { void download(); }}>{busy ? 'Exporting…' : 'Download .n4a'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
