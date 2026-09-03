import { useState } from "react";
import { Loader2, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { PersistedArchiveV2Selection } from "@/types/archiveV2Prediction";
import { parsePastedSpectra } from "./DataInputData";

interface ArchiveV2DataInputProps {
  selection: PersistedArchiveV2Selection | null;
  isLoading: boolean;
  onRunPrediction: (spectra: number[][]) => void;
}

export function ArchiveV2DataInput({
  selection,
  isLoading,
  onRunPrediction,
}: ArchiveV2DataInputProps) {
  const [pasteText, setPasteText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const spectra = parsePastedSpectra(pasteText);
    if (!spectra) {
      setError("Paste a finite JSON, CSV, or TSV matrix.");
      return;
    }
    setError(null);
    onRunPrediction(spectra);
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-3">
        <CardTitle>Native array input</CardTitle>
        <p className="text-sm text-muted-foreground">
          Paste raw spectra. Dataset replay, upload, fitting, Python, and fallback
          are not part of this Archive V2 surface.
        </p>
        {selection ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{selection.n_features} features</Badge>
            {selection.target_names.map((target) => (
              <Badge key={target} variant="secondary">{target}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm font-medium">Select a persisted Archive V2 first.</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          aria-label="Raw spectra matrix"
          placeholder={'[[1.0, 2.0], [3.0, 4.0]]'}
          value={pasteText}
          onChange={(event) => {
            setPasteText(event.target.value);
            setError(null);
          }}
          rows={9}
          className="font-mono text-xs"
          disabled={!selection || isLoading}
        />
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <Button
          type="button"
          className="w-full"
          size="lg"
          disabled={!selection || isLoading || !pasteText.trim()}
          onClick={handleSubmit}
        >
          {isLoading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Running native replay</>
          ) : (
            <><Play className="mr-2 h-4 w-4" />Run Archive V2 prediction</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
