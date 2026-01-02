import { Undo2, Redo2, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { DataUpload } from './DataUpload';
import { OperatorPalette } from './OperatorPalette';
import { PipelineBuilder } from './PipelineBuilder';
import { SpectralData, PipelineOperator, OperatorType } from '@/types/spectral';

interface PlaygroundSidebarProps {
  data: SpectralData | null;
  isLoading: boolean;
  error: string | null;
  operators: PipelineOperator[];
  canUndo: boolean;
  canRedo: boolean;
  onLoadFile: (file: File) => void;
  onLoadDemo: () => void;
  onClearData: () => void;
  onAddOperator: (type: OperatorType) => void;
  onUpdateOperator: (id: string, updates: Partial<PipelineOperator>) => void;
  onRemoveOperator: (id: string) => void;
  onToggleOperator: (id: string) => void;
  onReorderOperators: (fromIndex: number, toIndex: number) => void;
  onClearPipeline: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function PlaygroundSidebar({
  data,
  isLoading,
  error,
  operators,
  canUndo,
  canRedo,
  onLoadFile,
  onLoadDemo,
  onClearData,
  onAddOperator,
  onUpdateOperator,
  onRemoveOperator,
  onToggleOperator,
  onReorderOperators,
  onClearPipeline,
  onUndo,
  onRedo,
}: PlaygroundSidebarProps) {
  return (
    <div className="w-72 bg-card border-r border-border flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FlaskConical className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-foreground">NIR Lab</h1>
              <p className="text-xs text-muted-foreground">Preprocessing Playground</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={!canUndo}
              onClick={onUndo}
              title="Undo"
            >
              <Undo2 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={!canRedo}
              onClick={onRedo}
              title="Redo"
            >
              <Redo2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <DataUpload
          data={data}
          isLoading={isLoading}
          error={error}
          onLoadFile={onLoadFile}
          onLoadDemo={onLoadDemo}
          onClear={onClearData}
        />

        <Separator />

        {data && (
          <>
            <OperatorPalette onAddOperator={onAddOperator} />
            <Separator />
            <PipelineBuilder
              operators={operators}
              onUpdate={onUpdateOperator}
              onRemove={onRemoveOperator}
              onToggle={onToggleOperator}
              onReorder={onReorderOperators}
              onClear={onClearPipeline}
            />
          </>
        )}
      </ScrollArea>
    </div>
  );
}
