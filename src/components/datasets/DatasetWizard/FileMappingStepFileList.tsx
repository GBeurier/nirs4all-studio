import type { DragEventHandler } from "react";
import { File, Plus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DetectedFile, WizardState } from "@/types/datasets";
import { FileMappingStepFileRow } from "./FileMappingStepFileRow";

interface FileMappingStepFileListProps {
  files: DetectedFile[];
  validatedShapes: WizardState["validatedShapes"];
  maxSource: number;
  isDraggingOver: boolean;
  onAddFiles: () => void;
  onUpdateFile: (index: number, updates: Partial<DetectedFile>) => void;
  onRemoveFile: (index: number) => void;
  onDragEnter: DragEventHandler<HTMLDivElement>;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
}

export function FileMappingStepFileList({
  files,
  validatedShapes,
  maxSource,
  isDraggingOver,
  onAddFiles,
  onUpdateFile,
  onRemoveFile,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: FileMappingStepFileListProps) {
  return (
    <div
      className="flex-1 min-h-0 flex flex-col"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <FileMappingStepFileListHeader filesCount={files.length} onAddFiles={onAddFiles} />

      <div className={`flex-1 relative border rounded-md transition-colors ${isDraggingOver ? "border-primary border-dashed bg-primary/5" : ""}`}>
        <ScrollArea className="h-full">
          {files.length > 0 ? (
            files.map((file, index) => (
              <FileMappingStepFileRow
                key={file.path}
                file={file}
                onUpdate={(updates) => onUpdateFile(index, updates)}
                onRemove={() => onRemoveFile(index)}
                maxSource={maxSource}
                validatedShape={validatedShapes[file.path]}
              />
            ))
          ) : (
            <FileMappingStepEmptyState onAddFiles={onAddFiles} />
          )}
        </ScrollArea>

        {isDraggingOver && <FileMappingStepDragOverlay />}
      </div>
    </div>
  );
}

interface FileMappingStepFileListHeaderProps {
  filesCount: number;
  onAddFiles: () => void;
}

function FileMappingStepFileListHeader({
  filesCount,
  onAddFiles,
}: FileMappingStepFileListHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-2">
      <Label>
        Dataset Files <span className="text-muted-foreground">({filesCount})</span>
      </Label>
      <Button
        variant="ghost"
        size="sm"
        onClick={onAddFiles}
        className="h-7 text-xs"
      >
        <Plus className="h-3 w-3 mr-1" />
        Add Files
      </Button>
    </div>
  );
}

interface FileMappingStepEmptyStateProps {
  onAddFiles: () => void;
}

function FileMappingStepEmptyState({ onAddFiles }: FileMappingStepEmptyStateProps) {
  return (
    <div className="p-8 text-center text-muted-foreground">
      <File className="h-8 w-8 mx-auto mb-2 opacity-50" />
      <p>No files detected</p>
      <p className="text-xs mt-1">Drag files here or use the button below</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={onAddFiles}
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Files
      </Button>
    </div>
  );
}

function FileMappingStepDragOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-primary/5 rounded-md pointer-events-none z-10">
      <div className="flex flex-col items-center gap-2 text-primary">
        <Upload className="h-8 w-8" />
        <span className="text-sm font-medium">Drop files to add</span>
      </div>
    </div>
  );
}
