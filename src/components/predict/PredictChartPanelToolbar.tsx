import { useTranslation } from "react-i18next";
import {
  Activity,
  BarChart3,
  FileSpreadsheet,
  Grid3x3,
  ImageDown,
  Maximize2,
  TrendingUp,
} from "lucide-react";
import { ChartConfigPopover } from "@/components/predictions/viewer/ChartConfigPopover";
import type {
  ChartConfig,
  ChartKind,
  ViewerMetadataType,
} from "@/components/predictions/viewer/types";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface PredictChartPanelToolbarProps {
  availableKinds: ChartKind[];
  canExport: boolean;
  config: ChartConfig;
  isFullscreen?: boolean;
  kind: ChartKind;
  metadataColumns: string[];
  onConfigChange: (next: ChartConfig | ((prev: ChartConfig) => ChartConfig)) => void;
  onConfigReset: () => void;
  onExportCsv: () => void;
  onExportPng: () => void;
  onExpand?: () => void;
  onKindChange: (next: ChartKind) => void;
  resolvedMetadataType: ViewerMetadataType | null;
}

export function PredictChartPanelToolbar({
  availableKinds,
  canExport,
  config,
  isFullscreen,
  kind,
  metadataColumns,
  onConfigChange,
  onConfigReset,
  onExportCsv,
  onExportPng,
  onExpand,
  onKindChange,
  resolvedMetadataType,
}: PredictChartPanelToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2">
      <ToggleGroup
        type="single"
        size="sm"
        value={kind}
        onValueChange={(value) => {
          if (value && availableKinds.includes(value as ChartKind)) {
            onKindChange(value as ChartKind);
          }
        }}
        className="justify-start"
      >
        {availableKinds.includes("scatter") && (
          <ToggleGroupItem value="scatter" className="h-8 gap-1.5 text-xs">
            <TrendingUp className="h-3.5 w-3.5" />
            {t("predict.view.chart.scatter")}
          </ToggleGroupItem>
        )}
        {availableKinds.includes("residuals") && (
          <ToggleGroupItem value="residuals" className="h-8 gap-1.5 text-xs">
            <BarChart3 className="h-3.5 w-3.5" />
            {t("predict.view.chart.residuals")}
          </ToggleGroupItem>
        )}
        {availableKinds.includes("confusion") && (
          <ToggleGroupItem value="confusion" className="h-8 gap-1.5 text-xs">
            <Grid3x3 className="h-3.5 w-3.5" />
            {t("predict.view.chart.confusion")}
          </ToggleGroupItem>
        )}
        {availableKinds.includes("distribution") && (
          <ToggleGroupItem value="distribution" className="h-8 gap-1.5 text-xs">
            <Activity className="h-3.5 w-3.5" />
            {t("predict.view.chart.distribution")}
          </ToggleGroupItem>
        )}
      </ToggleGroup>

      <div className="flex items-center gap-1.5">
        <ChartConfigPopover
          kind={kind}
          config={config}
          metadataColumns={metadataColumns}
          resolvedMetadataType={resolvedMetadataType}
          onChange={onConfigChange}
          onReset={onConfigReset}
        />
        {onExpand && !isFullscreen && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onExpand}
            title={t("predict.view.chart.expandTitle")}
            aria-label={t("predict.view.chart.expandTitle")}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("predict.view.chart.expand")}</span>
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={onExportPng}
          disabled={!canExport}
          title={t("predict.view.chart.exportPng")}
        >
          <ImageDown className="h-3.5 w-3.5" />
          PNG
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={onExportCsv}
          title={t("predict.view.chart.exportCsv")}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          CSV
        </Button>
      </div>
    </div>
  );
}
