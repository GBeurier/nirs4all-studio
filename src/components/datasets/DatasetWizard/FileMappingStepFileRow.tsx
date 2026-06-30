import { useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  File as FileIcon,
  Sparkles,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DetectedFile } from "@/types/datasets";
import {
  FILE_ROLE_OPTIONS,
  FILE_SPLIT_OPTIONS,
  buildRoleUpdate,
  formatSize,
  getFileShapeDisplay,
  getSourceOptions,
  type ValidatedFileShape,
} from "./FileMappingStepLogic";

interface FileMappingStepFileRowProps {
  file: DetectedFile;
  onUpdate: (updates: Partial<DetectedFile>) => void;
  onRemove: () => void;
  maxSource: number;
  validatedShape?: ValidatedFileShape;
}

export function FileMappingStepFileRow({
  file,
  onUpdate,
  onRemove,
  maxSource,
  validatedShape,
}: FileMappingStepFileRowProps) {
  const [expanded, setExpanded] = useState(false);
  const shapeDisplay = getFileShapeDisplay(file, validatedShape);

  return (
    <div className="border-b last:border-0">
      <div className="p-3 hover:bg-muted/30">
        <div className="flex items-start gap-3">
          <FileIcon className="h-4 w-4 text-primary mt-1 flex-shrink-0" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm truncate flex-1" title={file.path}>
                {file.filename}
              </span>

              {file.detected && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="secondary" className="text-xs">
                        <Sparkles className="h-3 w-3 mr-1" />
                        Auto
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      Auto-detected ({Math.round(file.confidence * 100)}%
                      confidence)
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              <Badge variant="outline" className="text-xs uppercase">
                {file.format}
              </Badge>

              <span className="text-xs text-muted-foreground">
                {formatSize(file.size_bytes)}
              </span>

              {shapeDisplay.status === "error" ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="outline" className="text-xs font-mono text-destructive border-destructive/50">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        Error
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>{shapeDisplay.error}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : shapeDisplay.status === "shape" ? (
                <Badge variant="outline" className="text-xs font-mono">
                  {shapeDisplay.numRows} × {shapeDisplay.numColumns}
                </Badge>
              ) : null}

              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={onRemove}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Role</Label>
                <Select
                  value={file.type}
                  onValueChange={(value) =>
                    onUpdate(buildRoleUpdate(file, value as DetectedFile["type"]))
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILE_ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Split</Label>
                <Select
                  value={file.split}
                  onValueChange={(value) =>
                    onUpdate({ split: value as DetectedFile["split"] })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILE_SPLIT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Source</Label>
                {file.type === "X" ? (
                  <Select
                    value={String(file.source || 1)}
                    onValueChange={(value) => onUpdate({ source: Number.parseInt(value) })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getSourceOptions(maxSource).map((source) => (
                        <SelectItem key={source} value={String(source)}>
                          Source {source}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-8 px-3 flex items-center text-xs text-muted-foreground bg-muted/50 rounded-md">
                    N/A
                  </div>
                )}
              </div>
            </div>

            {expanded && (
              <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="font-medium">Full path:</span>
                    <div className="font-mono truncate">{file.path}</div>
                  </div>
                  <div>
                    <span className="font-medium">Format:</span>
                    <div>{file.format.toUpperCase()}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
