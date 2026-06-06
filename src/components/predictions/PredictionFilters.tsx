import { Brain, Database, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DataVisibility, FoldVisibility } from "@/lib/predictions/rows";

const toggleItemClass = "h-7 px-2 text-[11px] border-border/60 hover:bg-muted/60 hover:text-foreground data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10 data-[state=on]:text-primary";

interface PredictionFiltersProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  filterDataset: string;
  onFilterDatasetChange: (value: string) => void;
  filterModel: string;
  onFilterModelChange: (value: string) => void;
  filterTaskType: string;
  onFilterTaskTypeChange: (value: string) => void;
  datasetOptions: string[];
  modelOptions: string[];
  taskTypeOptions: string[];
  visibleFoldTypes: FoldVisibility[];
  onVisibleFoldTypesChange: (value: FoldVisibility[]) => void;
  visibleDataKinds: DataVisibility[];
  onVisibleDataKindsChange: (value: DataVisibility[]) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function PredictionFilters({
  searchQuery,
  onSearchQueryChange,
  filterDataset,
  onFilterDatasetChange,
  filterModel,
  onFilterModelChange,
  filterTaskType,
  onFilterTaskTypeChange,
  datasetOptions,
  modelOptions,
  taskTypeOptions,
  visibleFoldTypes,
  onVisibleFoldTypesChange,
  visibleDataKinds,
  onVisibleDataKindsChange,
  hasActiveFilters,
  onClearFilters,
}: PredictionFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search models, datasets..."
          value={searchQuery}
          onChange={event => onSearchQueryChange(event.target.value)}
          className="pl-9 h-8 bg-muted/50 text-sm"
        />
      </div>
      <Select value={filterDataset} onValueChange={onFilterDatasetChange}>
        <SelectTrigger className="w-[170px] h-8 bg-muted/50 text-xs">
          <Database className="h-3.5 w-3.5 mr-1" />
          <SelectValue placeholder="Dataset" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Datasets</SelectItem>
          {datasetOptions.map(datasetName => <SelectItem key={datasetName} value={datasetName}>{datasetName}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filterModel} onValueChange={onFilterModelChange}>
        <SelectTrigger className="w-[160px] h-8 bg-muted/50 text-xs">
          <Brain className="h-3.5 w-3.5 mr-1" />
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Models</SelectItem>
          {modelOptions.map(modelName => <SelectItem key={modelName} value={modelName}>{modelName}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filterTaskType} onValueChange={onFilterTaskTypeChange}>
        <SelectTrigger className="w-[140px] h-8 bg-muted/50 text-xs">
          <SelectValue placeholder="Task" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Tasks</SelectItem>
          {taskTypeOptions.map(taskType => <SelectItem key={taskType} value={taskType}>{taskType}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/20 px-1 py-1">
        <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Type</span>
        <ToggleGroup
          type="multiple"
          value={visibleFoldTypes}
          onValueChange={value => { if (value.length > 0) onVisibleFoldTypesChange(value as FoldVisibility[]); }}
          variant="outline"
          size="sm"
          className="h-7"
        >
          <ToggleGroupItem value="folds" className={toggleItemClass}>Folds</ToggleGroupItem>
          <ToggleGroupItem value="refits" className={toggleItemClass}>Refits</ToggleGroupItem>
          <ToggleGroupItem value="averages" className={toggleItemClass}>Averages</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/20 px-1 py-1">
        <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Data</span>
        <ToggleGroup
          type="multiple"
          value={visibleDataKinds}
          onValueChange={value => { if (value.length > 0) onVisibleDataKindsChange(value as DataVisibility[]); }}
          variant="outline"
          size="sm"
          className="h-7"
        >
          <ToggleGroupItem value="raw" className={toggleItemClass}>Raw</ToggleGroupItem>
          <ToggleGroupItem value="aggregated" className={toggleItemClass}>Aggregated</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-7 text-xs text-muted-foreground">
          Clear
        </Button>
      )}
    </div>
  );
}
