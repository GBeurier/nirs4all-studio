/**
 * FinetuneParamList - List of parameters to optimize with add functionality
 */

import { useState, useMemo } from "react";
import { Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { FinetuneParamConfig } from "../types";
import { formatParamType, type ParamPreset } from "./types";
import { getPresetsForModel } from "./presets";
import { FinetuneParamEditor } from "./FinetuneParamEditor";

interface FinetuneParamListProps {
  params: FinetuneParamConfig[];
  onUpdate: (params: FinetuneParamConfig[]) => void;
  modelName: string;
  availableParams: string[];
}

export function FinetuneParamList({
  params,
  onUpdate,
  modelName,
  availableParams,
}: FinetuneParamListProps) {
  const [showAddPopover, setShowAddPopover] = useState(false);

  // Get presets for this model
  const presets = useMemo(() => getPresetsForModel(modelName), [modelName]);

  // Filter out already-added params
  const unusedParams = useMemo(
    () => availableParams.filter((p) => !params.find((ep) => ep.name === p)),
    [availableParams, params]
  );

  const unusedPresets = useMemo(
    () => presets.filter((p) => !params.find((ep) => ep.name === p.name)),
    [presets, params]
  );

  const handleAddParam = (name: string, preset?: ParamPreset) => {
    const newParam: FinetuneParamConfig = preset
      ? {
          name: preset.name,
          type: preset.type,
          low: preset.low,
          high: preset.high,
          step: preset.step,
          choices: preset.choices,
        }
      : {
          name,
          type: "int",
          low: 1,
          high: 10,
        };
    onUpdate([...params, newParam]);
    setShowAddPopover(false);
  };

  const handleUpdateParam = (
    index: number,
    updates: Partial<FinetuneParamConfig>
  ) => {
    const newParams = [...params];
    newParams[index] = { ...newParams[index], ...updates };
    onUpdate(newParams);
  };

  const handleRemoveParam = (index: number) => {
    onUpdate(params.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium flex-shrink-0">Parameters to Optimize</Label>
        <Popover open={showAddPopover} onOpenChange={setShowAddPopover}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-purple-500/50 text-purple-500 hover:bg-purple-500/10 flex-shrink-0"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 bg-popover p-0">
            <div className="p-3 border-b border-border">
              <h4 className="font-medium text-sm">Add Tunable Parameter</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Select from presets or add custom
              </p>
            </div>

            <ScrollArea className="max-h-64">
              <div className="p-2">
                {/* Presets */}
                {unusedPresets.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs text-muted-foreground px-2 py-1 font-medium">
                      Recommended for {modelName}
                    </p>
                    {unusedPresets.map((preset) => (
                      <Button
                        key={preset.name}
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start h-auto py-2 px-2"
                        onClick={() => handleAddParam(preset.name, preset)}
                      >
                        <div className="flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm">
                              {preset.name}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {formatParamType(preset.type)}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {preset.description}
                          </p>
                        </div>
                      </Button>
                    ))}
                  </div>
                )}

                {/* Other available params */}
                {unusedParams.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground px-2 py-1 font-medium">
                      Other Parameters
                    </p>
                    <div className="flex flex-wrap gap-1 px-2">
                      {unusedParams.map((param) => (
                        <Button
                          key={param}
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => handleAddParam(param)}
                        >
                          {param}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {unusedParams.length === 0 && unusedPresets.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    All available parameters have been added
                  </p>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      {/* Parameter list */}
      {params.length === 0 ? (
        <div className="text-center py-6 bg-muted/30 rounded-lg border border-dashed">
          <Settings2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No parameters configured
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Add parameters to define the search space
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {params.map((param, index) => (
            <FinetuneParamEditor
              key={param.name}
              param={param}
              onUpdate={(updates) => handleUpdateParam(index, updates)}
              onRemove={() => handleRemoveParam(index)}
              existingParams={params.map((p) => p.name)}
              modelName={modelName}
            />
          ))}
        </div>
      )}
    </div>
  );
}
