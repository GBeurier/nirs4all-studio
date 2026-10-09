import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [pasteText, setPasteText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const spectra = parsePastedSpectra(pasteText);
    if (!spectra) {
      setError(t("predict.archiveInput.invalid"));
      return;
    }
    setError(null);
    onRunPrediction(spectra);
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-3">
        <CardTitle>{t("predict.archiveInput.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("predict.archiveInput.description")}
        </p>
        {selection ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{t("predict.archiveInput.features", { count: selection.n_features })}</Badge>
            {selection.target_names.map((target) => (
              <Badge key={target} variant="secondary">{target}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm font-medium">{t("predict.archiveInput.selectFirst")}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          aria-label={t("predict.archiveInput.matrixAria")}
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
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("predict.archiveInput.calculating")}</>
          ) : (
            <><Play className="mr-2 h-4 w-4" />{t("predict.archiveInput.calculate")}</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
