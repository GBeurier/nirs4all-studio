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
      setError("Paste a table of numeric values in CSV, TSV, or JSON format. All values must be finite.");
      return;
    }
    setError(null);
    onRunPrediction(spectra);
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-3">
        <CardTitle>Enter Spectra</CardTitle>
        <p className="text-sm text-muted-foreground">
          Paste your spectra as a table: one sample per row, one wavelength per column.
        </p>
        {selection ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{selection.n_features} features</Badge>
            {selection.target_names.map((target) => (
              <Badge key={target} variant="secondary">{target}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm font-medium">Select a saved model first.</p>
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
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Calculating predictions...</>
          ) : (
            <><Play className="mr-2 h-4 w-4" />Calculate Predictions</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
