import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Globe, Loader2, RefreshCw, Search } from "lucide-react";

import { publicDatasetPageUrl, type PublicDataset } from "@/api/public-datasets";
import { getApiErrorMessage } from "@/api/transport";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  filterPublicDatasets,
  isPublicDatasetImportBusy,
  resolvePublicDatasetSource,
  usePublicDatasetCatalog,
  type PublicDatasetImportController,
  type PublicDatasetImportState,
} from "@/hooks/usePublicDatasets";
import { getActiveLocale } from "@/lib/activeLocale";
import { cn } from "@/lib/utils";
import { openExternal } from "@/utils/fileDialogs";

interface PublicDatasetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active workspace; importing requires one, browsing does not. */
  workspaceId: string | null;
  importer: PublicDatasetImportController;
}

function formatCount(value: number | null): string {
  return value === null ? "--" : value.toLocaleString(getActiveLocale());
}

function stageText(state: PublicDatasetImportState): string {
  if (state.progressMessage) return state.progressMessage;
  switch (state.phase) {
    case "submitting": return "Submitting import request…";
    case "pending": return "Waiting for the import to start…";
    case "running": return "Downloading and adding the dataset…";
    default: return "";
  }
}

function ImportActivity({ state }: { state: PublicDatasetImportState }) {
  const progress = state.progress === null ? null : Math.min(100, Math.max(0, state.progress));
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        <span>
          {state.cancelRequested ? "Cancelling the import…" : stageText(state)}
        </span>
      </div>
      {progress === null ? (
        <div
          role="progressbar"
          aria-label="Import progress"
          aria-valuetext="Progress not reported"
          className="relative h-2 w-full overflow-hidden rounded-full bg-primary/20"
        >
          <div className="h-full w-1/3 rounded-full bg-primary animate-pulse motion-reduce:animate-none" />
        </div>
      ) : (
        <Progress value={progress} aria-label="Import progress" />
      )}
      {state.workspacePath && (
        <p className="text-xs text-muted-foreground truncate">Destination: {state.workspacePath}</p>
      )}
    </div>
  );
}

function PublicDatasetRow({
  dataset,
  selected,
  disabled,
  onSelect,
}: {
  dataset: PublicDataset;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const pageUrl = publicDatasetPageUrl(dataset.id);
  return (
    <li
      className={cn(
        "rounded-md border p-3 transition-colors",
        selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
          aria-pressed={selected}
          disabled={disabled}
          onClick={onSelect}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{dataset.name}</span>
            {dataset.domain && <Badge variant="secondary">{dataset.domain}</Badge>}
            {dataset.n_sources > 1 && <Badge variant="outline">{dataset.n_sources} sources</Badge>}
          </div>
          <p className="break-all text-xs text-muted-foreground font-mono">{dataset.id}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatCount(dataset.n_samples)} samples · {formatCount(dataset.n_features_total)} features
            {" · "}{dataset.n_targets} {dataset.n_targets === 1 ? "target" : "targets"} · {dataset.license}
          </p>
        </button>
        <a
          href={pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
          aria-label={`Details for ${dataset.name} on datasets.nirs4all.org`}
          onClick={(event) => {
            event.preventDefault();
            void openExternal(pageUrl);
          }}
        >
          Details
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
    </li>
  );
}

export function PublicDatasetsDialog({ open, onOpenChange, workspaceId, importer }: PublicDatasetsDialogProps) {
  const catalogQuery = usePublicDatasetCatalog(open);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);

  const { state } = importer;
  const busy = isPublicDatasetImportBusy(state.phase);
  const catalog = catalogQuery.data?.datasets;
  const visible = useMemo(() => filterPublicDatasets(catalog ?? [], search), [catalog, search]);
  const selected = catalog?.find((dataset) => dataset.id === selectedId) ?? null;
  const source = selected ? resolvePublicDatasetSource(selected, sourceId) : null;
  const canImport = Boolean(workspaceId && selected && source?.ready && !busy);
  const catalogError = getApiErrorMessage(catalogQuery.error);

  const selectDataset = (id: string) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setSourceId(null);
    importer.reset();
  };

  const submit = () => {
    if (!canImport || !selected || !source) return;
    void importer.start(selected.id, source.sourceId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl grid-cols-1 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" aria-hidden />
            Public datasets
          </DialogTitle>
          <DialogDescription>
            Browse the nirs4all public dataset catalogue, then download a dataset and add its spectra,
            targets and metadata to the active workspace.
            {catalogQuery.data?.version && ` Catalogue version ${catalogQuery.data.version}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              aria-label="Search public datasets"
              placeholder="Search by name, id or domain"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>

          <div className="max-h-[320px] overflow-y-auto pr-1">
            {catalogQuery.isLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading the public catalogue…
              </div>
            ) : catalogError ? (
              <div className="space-y-2 py-4" role="alert">
                <p className="text-sm text-destructive">Could not load public datasets: {catalogError}</p>
                <Button variant="outline" size="sm" onClick={() => { void catalogQuery.refetch(); }}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
                  Retry
                </Button>
              </div>
            ) : visible.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                {catalog?.length ? "No public dataset matches this search." : "The public catalogue is empty."}
              </p>
            ) : (
              <ul className="space-y-2" aria-label="Public datasets">
                {visible.map((dataset) => (
                  <PublicDatasetRow
                    key={dataset.id}
                    dataset={dataset}
                    selected={dataset.id === selectedId}
                    disabled={busy}
                    onSelect={() => selectDataset(dataset.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          {selected && source?.required && (
            <div className="space-y-2">
              <Label id="public-dataset-source-label">Source to import</Label>
              <p className="text-xs text-muted-foreground">
                This dataset has {selected.n_sources} sources. Choose the one to add to the workspace.
              </p>
              <RadioGroup
                aria-labelledby="public-dataset-source-label"
                value={sourceId ?? ""}
                onValueChange={setSourceId}
                disabled={busy}
                className="grid-cols-2"
              >
                {selected.source_ids.map((id) => (
                  <div key={id} className="flex items-center gap-2">
                    <RadioGroupItem value={id} id={`public-dataset-source-${id}`} />
                    <Label htmlFor={`public-dataset-source-${id}`} className="font-mono text-xs">{id}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {busy && state.phase !== "disconnected" && <ImportActivity state={state} />}

          {state.phase === "completed" && state.dataset && (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400" role="status">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Added “{state.dataset.name}” to the workspace.
            </p>
          )}
          {state.phase === "cancelled" && (
            <p className="text-sm text-muted-foreground" role="status">Import cancelled.</p>
          )}
          {state.error && <p className="text-sm text-destructive" role="alert">{state.error}</p>}
          {!workspaceId && (
            <p className="text-sm text-muted-foreground">Select a workspace to import public datasets.</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {state.phase === "disconnected" && (
            <>
              <Button variant="outline" onClick={importer.reset}>Dismiss</Button>
              <Button variant="outline" onClick={importer.resume}>Check again</Button>
            </>
          )}
          {(state.phase === "pending" || state.phase === "running") && (
            <Button
              variant="outline"
              disabled={state.cancelRequested}
              onClick={() => { void importer.cancel(); }}
            >
              Cancel import
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {busy ? "Hide" : "Close"}
          </Button>
          <Button disabled={!canImport} onClick={submit}>
            {state.phase === "submitting" ? "Starting…" : "Download and add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
