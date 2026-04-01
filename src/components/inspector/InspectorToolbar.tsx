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
import { useInspectorSelection } from "@/context/InspectorSelectionContext";
import { useInspectorData } from "@/context/InspectorDataContext";
import { useInspectorFilter } from "@/context/InspectorFilterContext";
import { useInspectorView, type LayoutMode } from "@/context/InspectorViewContext";
import { useInspectorExport } from "@/hooks/useInspectorExport";
import { INSPECTOR_PANELS } from "@/lib/inspector/chartRegistry";
import { isLowerBetter } from "@/lib/scores";
import { SCORE_COLUMNS } from "@/types/inspector";
import type { ScoreColumn } from "@/types/inspector";
import { InspectorSelectionModeToggle } from "./InspectorSelectionTools";

const LAYOUT_OPTIONS: { value: LayoutMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "grid-2", label: "2 columns" },
  { value: "grid-3", label: "3 columns" },
  { value: "single-column", label: "Stacked" },
];

export function InspectorToolbar() {
  const { selectedCount, hasSelection, clear, pinnedCount } = useInspectorSelection();
  const { scoreColumn, setScoreColumn, partition, setPartition, totalChains, chains } = useInspectorData();
  const { activeFilterCount, filteredChains } = useInspectorFilter();
  const { exportDataAsCsv, exportAllVisiblePanelsPng } = useInspectorExport();
  const { panelStates, layoutMode, setLayoutMode, togglePanel, showAll, resetView } = useInspectorView();

  const filteredCount = filteredChains.length;
  const referenceMetric = chains.find(chain => chain.metric)?.metric ?? null;
  const directionLabel = isLowerBetter(referenceMetric) ? "Lower is better" : "Higher is better";
  const shownPanelsCount = Object.values(panelStates).filter(state => state !== "hidden").length;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-card/50 px-4 py-3">
      <InspectorSelectionModeToggle />

      <div className="h-5 w-px bg-border/60" />

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Score
        </span>
        <Select value={scoreColumn} onValueChange={value => setScoreColumn(value as ScoreColumn)}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCORE_COLUMNS.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
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
          Partition
        </span>
        <Select value={partition} onValueChange={setPartition}>
          <SelectTrigger className="h-8 w-[88px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="val">Val</SelectItem>
            <SelectItem value="test">Test</SelectItem>
            <SelectItem value="train">Train</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Layout
        </span>
        <Select value={layoutMode} onValueChange={value => setLayoutMode(value as LayoutMode)}>
          <SelectTrigger className="h-8 w-[112px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LAYOUT_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Settings2 className="h-3.5 w-3.5" />
            Panels
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Workspace Panels
          </DropdownMenuLabel>
          {INSPECTOR_PANELS.map(panel => (
            <DropdownMenuCheckboxItem
              key={panel.id}
              checked={panelStates[panel.id] !== "hidden"}
              onCheckedChange={() => togglePanel(panel.id)}
              className="text-xs"
            >
              {panel.name}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={showAll} className="text-xs">
            Show all panels
          </DropdownMenuItem>
          <DropdownMenuItem onClick={resetView} className="text-xs">
            Reset view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          {activeFilterCount > 0 ? `${filteredCount}/${totalChains} chains in scope` : `${totalChains} chains in scope`}
        </div>

        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs text-muted-foreground">
          <Settings2 className="h-3.5 w-3.5" />
          {shownPanelsCount} panels
        </div>

        {pinnedCount > 0 ? (
          <div className="flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-800 dark:text-indigo-300">
            <Pin className="h-3.5 w-3.5" />
            {pinnedCount} pinned
          </div>
        ) : null}

        {hasSelection ? (
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-800 dark:text-emerald-300">
            <Target className="h-3.5 w-3.5" />
            {selectedCount} selected
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[11px]" onClick={clear}>
              Clear
            </Button>
          </div>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={exportAllVisiblePanelsPng} className="text-xs">
              Export visible panels as PNG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportDataAsCsv} className="text-xs">
              Export filtered chains as CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
