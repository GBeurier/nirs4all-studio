/**
 * MetadataConfig - Configuration panel for with_metadata() step
 */

import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import type { SynthesisStepDefinition } from "../types";
import { getStepDescription } from "../definitionLabels";

interface MetadataConfigProps {
  params: Record<string, unknown>;
  definition: SynthesisStepDefinition;
  onChange: (params: Record<string, unknown>) => void;
}

export function MetadataConfig({
  params,
  definition,
  onChange,
}: MetadataConfigProps) {
  const { t } = useTranslation();
  const sampleIds = (params.sample_ids as boolean) ?? true;
  const sampleIdPrefix = (params.sample_id_prefix as string) || "sample";
  const nGroups = params.n_groups as number | null;
  const nRepetitions = (params.n_repetitions as number) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500/10">
          <FileText className="h-4 w-4 text-orange-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t("spectraSynthesis.config.metadata.title")}</h3>
          <p className="text-xs text-muted-foreground">{getStepDescription(t, definition.type)}</p>
        </div>
      </div>

      <Separator />

      {/* Generate Sample IDs */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.metadata.sampleIds.label")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("spectraSynthesis.config.metadata.sampleIds.hint")}
          </p>
        </div>
        <Switch
          checked={sampleIds}
          onCheckedChange={(v) => onChange({ sample_ids: v })}
        />
      </div>

      {/* Sample ID Prefix */}
      {sampleIds && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("spectraSynthesis.config.metadata.prefix.label")}</Label>
          <Input
            value={sampleIdPrefix}
            onChange={(e) => onChange({ sample_id_prefix: e.target.value })}
            placeholder="sample"
            className="h-8 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            {t("spectraSynthesis.config.metadata.prefix.hint", { prefix: sampleIdPrefix })}
          </p>
        </div>
      )}

      {/* Number of Groups */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">{t("spectraSynthesis.config.metadata.groups.label")}</Label>
        <Input
          type="number"
          value={nGroups ?? ""}
          onChange={(e) =>
            onChange({
              n_groups: e.target.value === "" ? null : parseInt(e.target.value),
            })
          }
          placeholder={t("spectraSynthesis.config.metadata.groups.placeholder")}
          min={2}
          max={100}
          className="h-8 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.config.metadata.groups.hint")}
        </p>
      </div>

      {/* Repetitions */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">{t("spectraSynthesis.config.metadata.repetitions.label")}</Label>
        <Input
          type="number"
          value={nRepetitions}
          onChange={(e) =>
            onChange({ n_repetitions: parseInt(e.target.value) || 1 })
          }
          min={1}
          max={10}
          className="h-8 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {t("spectraSynthesis.config.metadata.repetitions.hint")}
        </p>
      </div>
    </div>
  );
}
