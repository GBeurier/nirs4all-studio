import { useState } from "react";
import { Archive, CheckCircle2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearPersistedArchiveV2Selection,
  createPersistedArchiveV2Selection,
  parseArchiveV2TargetNames,
  persistArchiveV2Selection,
} from "@/lib/archiveV2Selection";
import type { PersistedArchiveV2Selection } from "@/types/archiveV2Prediction";

interface ModelSelectorProps {
  selectedModel: PersistedArchiveV2Selection | null;
  onSelect: (model: PersistedArchiveV2Selection | null) => void;
}

interface SelectionDraft {
  workspaceId: string;
  archiveRef: string;
  archiveSha256: string;
  nFeatures: string;
  targetNames: string;
}

const EMPTY_DRAFT: SelectionDraft = {
  workspaceId: "",
  archiveRef: "",
  archiveSha256: "",
  nFeatures: "",
  targetNames: "",
};

function draftFromSelection(
  selection: PersistedArchiveV2Selection,
): SelectionDraft {
  return {
    workspaceId: selection.workspace_id,
    archiveRef: selection.archive_ref,
    archiveSha256: selection.archive_sha256,
    nFeatures: String(selection.n_features),
    targetNames: selection.target_names.join(", "),
  };
}

export function ModelSelector({ selectedModel, onSelect }: ModelSelectorProps) {
  const [draft, setDraft] = useState<SelectionDraft>(() =>
    selectedModel ? draftFromSelection(selectedModel) : EMPTY_DRAFT,
  );
  const [error, setError] = useState<string | null>(null);

  const updateDraft = (field: keyof SelectionDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
  };

  const handleSave = () => {
    try {
      const selection = createPersistedArchiveV2Selection({
        workspace_id: draft.workspaceId,
        archive_ref: draft.archiveRef,
        archive_sha256: draft.archiveSha256,
        n_features: Number(draft.nFeatures),
        target_names: parseArchiveV2TargetNames(draft.targetNames),
      });
      persistArchiveV2Selection(selection);
      setDraft(draftFromSelection(selection));
      setError(null);
      onSelect(selection);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid Archive V2 selection.");
    }
  };

  const handleClear = () => {
    clearPersistedArchiveV2Selection();
    setDraft(EMPTY_DRAFT);
    setError(null);
    onSelect(null);
  };

  return (
    <Card className="overflow-hidden border-border/60 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4" />
            Persisted Archive V2
          </CardTitle>
          {selectedModel && (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> Native
            </Badge>
          )}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Enter the immutable workspace-relative archive contract. The native
          sidecar resolves the ref and verifies its SHA256 before replay.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="archive-workspace-id">Workspace ID</Label>
          <Input
            id="archive-workspace-id"
            value={draft.workspaceId}
            onChange={(event) => updateDraft("workspaceId", event.target.value)}
            placeholder="workspace-a"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="archive-ref">Archive ref</Label>
          <Input
            id="archive-ref"
            value={draft.archiveRef}
            onChange={(event) => updateDraft("archiveRef", event.target.value)}
            placeholder="models/calibration.n4a"
          />
          <p className="text-xs text-muted-foreground">
            Relative .n4a path only; absolute bundle or chain paths are refused.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="archive-sha256">Archive SHA256</Label>
          <Input
            id="archive-sha256"
            value={draft.archiveSha256}
            onChange={(event) => updateDraft("archiveSha256", event.target.value)}
            placeholder="64 lowercase hexadecimal characters"
            className="font-mono text-xs"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="archive-n-features">Feature count</Label>
            <Input
              id="archive-n-features"
              type="number"
              min={1}
              max={256}
              value={draft.nFeatures}
              onChange={(event) => updateDraft("nFeatures", event.target.value)}
              placeholder="11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="archive-target-names">Ordered targets</Label>
            <Input
              id="archive-target-names"
              value={draft.targetNames}
              onChange={(event) => updateDraft("targetNames", event.target.value)}
              placeholder="protein, moisture"
            />
          </div>
        </div>

        {selectedModel && (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <p className="truncate font-medium">{selectedModel.archive_ref}</p>
            <p className="mt-1 truncate font-mono text-muted-foreground">
              {selectedModel.archive_sha256}
            </p>
            <p className="mt-1 text-muted-foreground">
              {selectedModel.n_features} features · {selectedModel.target_names.join(" → ")}
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs leading-5 text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="button" className="flex-1" onClick={handleSave}>
            Verify and select
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Clear Archive V2 selection"
            onClick={handleClear}
            disabled={!selectedModel}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
