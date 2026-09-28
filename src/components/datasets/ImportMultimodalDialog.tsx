import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMultimodalDatasetSummary, type MultimodalDatasetSummary } from "@/lib/multimodalDatasetSummary";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (name: string, document: Record<string, unknown>) => Promise<void>;
}

export function ImportMultimodalDialog({ open, onOpenChange, onImport }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [document, setDocument] = useState<Record<string, unknown> | null>(null);
  const [summary, setSummary] = useState<MultimodalDatasetSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selection = useRef(0);

  const close = (next: boolean) => {
    if (busy && !next) return;
    if (!next) {
      selection.current += 1;
      setName("");
      setDocument(null);
      setSummary(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const selectFile = async (file: File | undefined) => {
    const current = ++selection.current;
    setDocument(null);
    setSummary(null);
    setError(null);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError(t("datasets.multimodalImport.tooLarge"));
      return;
    }
    try {
      const value: unknown = JSON.parse(await file.text());
      if (current !== selection.current) return;
      const candidate = value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
      if (candidate && new TextEncoder().encode(JSON.stringify(candidate)).length > 1024 * 1024) {
        throw new Error(t("datasets.multimodalImport.tooLarge"));
      }
      const projection = getMultimodalDatasetSummary(candidate);
      if (!candidate || !projection) throw new Error(t("datasets.multimodalImport.invalid"));
      setDocument(candidate);
      setSummary(projection);
      setName((current) => current.trim() ? current : file.name.replace(/\.json$/i, ""));
    } catch (cause) {
      if (current !== selection.current) return;
      setError(cause instanceof SyntaxError ? t("datasets.multimodalImport.invalidJson")
        : cause instanceof Error ? cause.message : t("datasets.multimodalImport.readError"));
    }
  };

  const submit = async () => {
    if (!document || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onImport(name.trim(), document);
      setBusy(false);
      close(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("datasets.multimodalImport.importError"));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("datasets.multimodalImport.title")}</DialogTitle>
          <DialogDescription>
            {t("datasets.multimodalImport.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="multimodal-descriptor-file">{t("datasets.multimodalImport.file")}</Label>
            <Input id="multimodal-descriptor-file" type="file" accept=".json,application/json"
              disabled={busy} onChange={(event) => { void selectFile(event.target.files?.[0]); }} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="multimodal-dataset-name">{t("datasets.multimodalImport.name")}</Label>
            <Input id="multimodal-dataset-name" value={name} disabled={busy}
              onChange={(event) => setName(event.target.value)} />
          </div>
          {summary && (
            <p className="text-sm text-muted-foreground" role="status">
              {t("datasets.multimodalImport.summary", {
                samples: summary.samples, sources: summary.sources.length, alignment: summary.alignment,
              })}
            </p>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => close(false)}>{t("common.cancel")}</Button>
          <Button disabled={busy || !document || !name.trim()} onClick={() => { void submit(); }}>
            {busy ? t("datasets.multimodalImport.importing") : t("datasets.multimodalImport.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
