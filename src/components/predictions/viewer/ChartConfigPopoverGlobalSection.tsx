import { useTranslation } from "react-i18next";

import { SelectItem } from "@/components/ui/select";
import {
  type ChartConfigUpdater,
  SectionHeader,
} from "./ChartConfigPopoverPrimitives";
import {
  MetadataColorControls,
  PartitionColorControls,
} from "./ChartConfigPopoverPaletteControls";
import {
  SelectRow,
  SwitchRow,
} from "./ChartConfigPopoverSectionControls";
import type {
  ChartConfig,
  ChartKind,
  ExportTheme,
  ViewerMetadataType,
} from "./types";
import type { PartitionColorKey } from "./ChartConfigPopoverData";

export function GlobalSection({
  kind,
  config,
  metadataColumns,
  hasMetadata,
  effectiveMetadataKey,
  effectiveMetadataType,
  currentPaletteColors,
  update,
  updateColorMode,
  updateMetadataKey,
  applyPartitionPalette,
  updatePartitionColor,
}: {
  kind: ChartKind;
  config: ChartConfig;
  metadataColumns: string[];
  hasMetadata: boolean;
  effectiveMetadataKey: string | undefined;
  effectiveMetadataType: ViewerMetadataType;
  currentPaletteColors: readonly string[];
  update: ChartConfigUpdater;
  updateColorMode: (value: string) => void;
  updateMetadataKey: (value: string) => void;
  applyPartitionPalette: (value: string) => void;
  updatePartitionColor: (key: PartitionColorKey, value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <SectionHeader>{t("predictions.viewer.config.global")}</SectionHeader>
      {kind !== "confusion" && (
        <>
          <ColorModeRow
            colorMode={config.colorMode}
            hasMetadata={hasMetadata}
            updateColorMode={updateColorMode}
          />

          {config.colorMode === "metadata" && (
            <MetadataColorControls
              config={config}
              metadataColumns={metadataColumns}
              hasMetadata={hasMetadata}
              effectiveMetadataKey={effectiveMetadataKey}
              effectiveMetadataType={effectiveMetadataType}
              update={update}
              updateMetadataKey={updateMetadataKey}
            />
          )}

          {config.colorMode === "partition" && (
            <PartitionColorControls
              config={config}
              currentPaletteColors={currentPaletteColors}
              applyPartitionPalette={applyPartitionPalette}
              updatePartitionColor={updatePartitionColor}
            />
          )}
        </>
      )}
      <ExportThemeRow exportTheme={config.exportTheme} update={update} />
      <SwitchRow
        label={t("predictions.viewer.config.rescaleAxes")}
        checked={config.rescaleToVisible}
        onCheckedChange={(value) => update("rescaleToVisible", value)}
      />
    </div>
  );
}

function ColorModeRow({
  colorMode,
  hasMetadata,
  updateColorMode,
}: {
  colorMode: ChartConfig["colorMode"];
  hasMetadata: boolean;
  updateColorMode: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <SelectRow label={t("predictions.viewer.config.colorBy")} value={colorMode} onValueChange={updateColorMode}>
      <SelectItem value="partition" className="text-xs">{t("predictions.viewer.config.colorByPartition")}</SelectItem>
      <SelectItem value="metadata" className="text-xs" disabled={!hasMetadata}>
        {t("predictions.viewer.config.colorByMetadata")}
      </SelectItem>
    </SelectRow>
  );
}

function ExportThemeRow({
  exportTheme,
  update,
}: {
  exportTheme: ExportTheme;
  update: ChartConfigUpdater;
}) {
  const { t } = useTranslation();
  return (
    <SelectRow
      label={t("predictions.viewer.config.exportTheme")}
      value={exportTheme}
      onValueChange={(value) => update("exportTheme", value as ExportTheme)}
    >
      <SelectItem value="inherit" className="text-xs">{t("predictions.viewer.config.themeInherit")}</SelectItem>
      <SelectItem value="light" className="text-xs">{t("predictions.viewer.config.themeLight")}</SelectItem>
      <SelectItem value="dark" className="text-xs">{t("predictions.viewer.config.themeDark")}</SelectItem>
    </SelectRow>
  );
}
