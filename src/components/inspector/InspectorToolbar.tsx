import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Download, Filter, Pin, Settings2, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useInspectorSelection } from "@/context/useInspectorSelection";
import { useInspectorData } from "@/context/useInspectorDataContext";
import { useInspectorFilter } from "@/context/useInspectorFilter";
import { useInspectorView, type LayoutMode } from "@/context/useInspectorView";
import { useInspectorExport } from "@/hooks/useInspectorExport";
import { INSPECTOR_PANELS } from "@/lib/inspector/chartRegistry";
import {
  buildInspectorMetricObservationReadModel,
  type InspectorScoreRefAvailability,
} from "@/lib/inspector/chartInputs";
import { buildInspectorTargetOptions } from "@/lib/inspector/targetSelection";
import {
  getInspectorScoreColumnLabel,
  getInspectorReferenceMetric,
  getInspectorScoreDirectionLabel,
  INSPECTOR_SCORE_OPTIONS,
} from "@/lib/inspector/scoreSelection";
import type { ScoreColumn } from "@/types/inspector";
import { InspectorSelectionModeToggle } from "./InspectorSelectionTools";

const AUTO_SCORE_REF_SELECT_VALUE = "__inspector_auto_score_ref__";

const LAYOUT_OPTIONS: { value: LayoutMode; labelKey: string }[] = [
  { value: "auto", labelKey: "inspector.toolbar.layouts.auto" },
  { value: "grid-2", labelKey: "inspector.toolbar.layouts.grid-2" },
  { value: "grid-3", labelKey: "inspector.toolbar.layouts.grid-3" },
  { value: "single-column", labelKey: "inspector.toolbar.layouts.single-column" },
];

type ObservedScoreRefOption = InspectorScoreRefAvailability & {
  legacyScoreColumn: ScoreColumn;
};

function isObservedScoreRefOption(scoreRef: InspectorScoreRefAvailability): scoreRef is ObservedScoreRefOption {
  return scoreRef.legacyScoreColumn != null && scoreRef.observationCount > 0;
}

function formatScoreRefOptionLabel(scoreRef: ObservedScoreRefOption, t: TFunction): string {
  const metricLabel = scoreRef.metric ?? t("inspector.toolbar.unknownMetric");
  const scoreLabel = getInspectorScoreColumnLabel(scoreRef.legacyScoreColumn, t);
  return `${metricLabel} / ${scoreLabel} / ${scoreRef.observationCount}`;
}

export function InspectorToolbar() {
  const { t } = useTranslation();
  const { selectedCount, hasSelection, clear, pinnedCount } = useInspectorSelection();
  const {
    scoreColumn,
    setScoreColumn,
    selectedScoreRefKey,
    setSelectedScoreRefKey,
    partition,
    setPartition,
    targetIndex,
    setTargetIndex,
    totalChains,
    chains,
    availableTargets,
  } = useInspectorData();
  const { activeFilterCount, filteredChains } = useInspectorFilter();
  const { exportDataAsCsv, exportAllVisiblePanelsPng } = useInspectorExport();
  const { panelStates, layoutMode, setLayoutMode, togglePanel, showAll, resetView } = useInspectorView();

  const filteredCount = filteredChains.length;
  const referenceMetric = getInspectorReferenceMetric(chains);
  const directionLabel = getInspectorScoreDirectionLabel(referenceMetric, t);
  const shownPanelsCount = Object.values(panelStates).filter(state => state !== "hidden").length;
  const metricObservations = useMemo(
    () => buildInspectorMetricObservationReadModel(filteredChains),
    [filteredChains],
  );
  const observedScoreRefs = useMemo(
    () => metricObservations.scoreRefs.filter(isObservedScoreRefOption),
    [metricObservations],
  );
  const targetOptions = useMemo(
    () => buildInspectorTargetOptions(filteredChains, targetIndex, availableTargets, t),
    [filteredChains, targetIndex, availableTargets, t],
  );
  const selectedScoreRefIsVisible = selectedScoreRefKey != null
    && observedScoreRefs.some(scoreRef => scoreRef.key === selectedScoreRefKey);
  const scoreRefSelectValue = selectedScoreRefIsVisible
    ? selectedScoreRefKey
    : AUTO_SCORE_REF_SELECT_VALUE;
  const handleScoreRefChange = (value: string) => {
    if (value === AUTO_SCORE_REF_SELECT_VALUE) {
      setSelectedScoreRefKey(null);
      return;
    }

    const scoreRef = observedScoreRefs.find(option => option.key === value);
    setSelectedScoreRefKey(value);
    if (scoreRef) {
      setScoreColumn(scoreRef.legacyScoreColumn);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-card/80 px-4 py-2.5 backdrop-blur-sm">
      <InspectorSelectionModeToggle />

      <div className="h-5 w-px bg-border/60" />

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t("inspector.toolbar.scoreColumn")}
        </span>
        <Select
          value={scoreColumn}
          onValueChange={value => {
            setScoreColumn(value as ScoreColumn);
            setSelectedScoreRefKey(null);
          }}
        >
          <SelectTrigger className="h-8 w-[170px] text-xs" aria-label={t("inspector.toolbar.scoreColumn")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INSPECTOR_SCORE_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={scoreRefSelectValue}
          onValueChange={handleScoreRefChange}
        >
          <SelectTrigger className="h-8 w-[220px] text-xs" aria-label={t("inspector.toolbar.scoreReference")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO_SCORE_REF_SELECT_VALUE}>{t("inspector.toolbar.auto")}</SelectItem>
            {observedScoreRefs.map(scoreRef => (
              <SelectItem key={scoreRef.key} value={scoreRef.key}>
                {formatScoreRefOptionLabel(scoreRef, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-[11px]">
          {directionLabel}
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t("inspector.toolbar.partition")}
        </span>
        <Select value={partition} onValueChange={setPartition}>
          <SelectTrigger className="h-8 w-[88px] text-xs" aria-label={t("inspector.toolbar.partition")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="val">{t("inspector.toolbar.partitions.val")}</SelectItem>
            <SelectItem value="test">{t("inspector.toolbar.partitions.test")}</SelectItem>
            <SelectItem value="train">{t("inspector.toolbar.partitions.train")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t("inspector.toolbar.target")}
        </span>
        <Select value={String(targetIndex)} onValueChange={value => setTargetIndex(Number(value))}>
          <SelectTrigger className="h-8 w-[104px] text-xs" aria-label={t("inspector.toolbar.target")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {targetOptions.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t("inspector.toolbar.layout")}
        </span>
        <Select value={layoutMode} onValueChange={value => setLayoutMode(value as LayoutMode)}>
          <SelectTrigger className="h-8 w-[112px] text-xs" aria-label={t("inspector.toolbar.layout")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LAYOUT_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Settings2 className="h-3.5 w-3.5" />
            {t("inspector.toolbar.panels")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
            {t("inspector.toolbar.workspacePanels")}
          </DropdownMenuLabel>
          {INSPECTOR_PANELS.map(panel => (
            <DropdownMenuCheckboxItem
              key={panel.id}
              checked={panelStates[panel.id] !== "hidden"}
              onCheckedChange={() => togglePanel(panel.id)}
              className="text-xs"
            >
              {t(panel.nameKey)}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={showAll} className="text-xs">
            {t("inspector.toolbar.showAllPanels")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={resetView} className="text-xs">
            {t("inspector.toolbar.resetView")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          {activeFilterCount > 0
            ? t("inspector.toolbar.chainsInScopeFiltered", { filtered: filteredCount, total: totalChains })
            : t("inspector.toolbar.chainsInScope", { count: totalChains })}
        </div>

        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs text-muted-foreground">
          <Settings2 className="h-3.5 w-3.5" />
          {t("inspector.counts.panels", { count: shownPanelsCount })}
        </div>

        {pinnedCount > 0 ? (
          <div className="flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-800 dark:text-indigo-300">
            <Pin className="h-3.5 w-3.5" />
            {t("inspector.counts.pinned", { count: pinnedCount })}
          </div>
        ) : null}

        {hasSelection ? (
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-800 dark:text-emerald-300">
            <Target className="h-3.5 w-3.5" />
            {t("inspector.counts.selected", { count: selectedCount })}
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[11px]" onClick={clear}>
              {t("common.clear")}
            </Button>
          </div>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" />
              {t("inspector.toolbar.export")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={exportAllVisiblePanelsPng} className="text-xs">
              {t("inspector.toolbar.exportVisiblePng")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportDataAsCsv} className="text-xs">
              {t("inspector.toolbar.exportFilteredCsv")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
