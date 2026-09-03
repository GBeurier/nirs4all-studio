import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, CheckCircle2, RefreshCw, Trash2 } from "lucide-react";

import { getPersistedArchiveV2Catalogue } from "@/api/archiveV2Prediction";
import { getLinkedWorkspaces } from "@/api/linkedWorkspaces";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  archiveV2SelectionIdentityEquals,
  clearPersistedArchiveV2Selection,
  createPersistedArchiveV2Selection,
  persistArchiveV2Selection,
  readPersistedArchiveV2Selection,
} from "@/lib/archiveV2Selection";
import type { ArchiveV2CatalogueEntry, PersistedArchiveV2Selection } from "@/types/archiveV2Prediction";

interface ModelSelectorProps {
  selectedModel: PersistedArchiveV2Selection | null;
  onSelect: (model: PersistedArchiveV2Selection | null) => void;
}

function selectionFromEntry(workspaceId: string, entry: ArchiveV2CatalogueEntry) {
  return createPersistedArchiveV2Selection({
    workspace_id: workspaceId,
    archive_ref: entry.archive_ref,
    archive_sha256: entry.archive_sha256,
    n_features: entry.n_features,
    target_names: entry.target_names,
  });
}

export function ModelSelector({ selectedModel, onSelect }: ModelSelectorProps) {
  const workspaces = useQuery({ queryKey: ["linked-workspaces", "archive-v2"], queryFn: getLinkedWorkspaces });
  const workspaceId = workspaces.data?.active_workspace_id ?? null;
  const catalogue = useQuery({
    queryKey: ["archive-v2-catalogue", workspaceId],
    queryFn: () => getPersistedArchiveV2Catalogue(workspaceId!),
    enabled: workspaceId !== null,
  });

  useEffect(() => {
    if (!catalogue.data || !workspaceId) return;
    const persisted = readPersistedArchiveV2Selection();
    const verified = persisted && catalogue.data.archives.some((entry) =>
      archiveV2SelectionIdentityEquals(persisted, selectionFromEntry(workspaceId, entry)),
    );
    if (verified) {
      if (!selectedModel || !archiveV2SelectionIdentityEquals(selectedModel, persisted)) onSelect(persisted);
    } else {
      clearPersistedArchiveV2Selection();
      if (selectedModel) onSelect(null);
    }
  }, [catalogue.data, onSelect, selectedModel, workspaceId]);

  const select = (entry: ArchiveV2CatalogueEntry) => {
    if (!workspaceId) return;
    const selection = selectionFromEntry(workspaceId, entry);
    persistArchiveV2Selection(selection);
    onSelect(selection);
  };
  const clear = () => {
    clearPersistedArchiveV2Selection();
    onSelect(null);
  };
  const error = workspaces.error || catalogue.error;
  const loading = workspaces.isPending || (workspaceId !== null && catalogue.isPending);

  return (
    <Card className="overflow-hidden border-border/60 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2"><Archive className="h-4 w-4" />Persisted Archive V2</CardTitle>
          {selectedModel && <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" />Verified</Badge>}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">Core-verified archives registered by the active workspace Store. Moved, changed, or unsafe entries stay hidden.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Loading verified archives…</p>}
        {!loading && !workspaceId && <p className="text-sm text-muted-foreground">Activate a linked workspace to choose an archive.</p>}
        {error && <p role="alert" className="text-sm text-destructive">The native Archive V2 catalogue is unavailable.</p>}
        {catalogue.data?.archives.length === 0 && <p className="text-sm text-muted-foreground">No verified Archive V2 is registered in this workspace.</p>}
        {catalogue.data?.archives.map((entry) => {
          const selection = selectionFromEntry(workspaceId!, entry);
          const active = selectedModel !== null && archiveV2SelectionIdentityEquals(selectedModel, selection);
          return (
            <button key={`${entry.archive_ref}:${entry.archive_sha256}`} type="button" onClick={() => select(entry)}
              className={`w-full rounded-lg border p-3 text-left text-xs transition-colors ${active ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}>
              <span className="block truncate font-medium">{entry.archive_id}</span>
              <span className="mt-1 block truncate text-muted-foreground">{entry.archive_ref}</span>
              <span className="mt-1 block text-muted-foreground">{entry.n_features} features · {entry.target_names.join(" → ")}</span>
            </button>
          );
        })}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => { void workspaces.refetch(); void catalogue.refetch(); }}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          <Button type="button" variant="outline" size="icon" aria-label="Clear Archive V2 selection" onClick={clear} disabled={!selectedModel}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}
