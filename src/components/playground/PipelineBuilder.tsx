import { useState } from 'react';
import { Layers, Trash2 } from 'lucide-react';
import { PipelineOperator } from '@/types/spectral';
import { OperatorCard } from './OperatorCard';
import { Button } from '@/components/ui/button';

interface PipelineBuilderProps {
  operators: PipelineOperator[];
  onUpdate: (id: string, updates: Partial<PipelineOperator>) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onClear: () => void;
}

export function PipelineBuilder({
  operators,
  onUpdate,
  onRemove,
  onToggle,
  onReorder,
  onClear,
}: PipelineBuilderProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      setDropIndex(index);
    }
  };

  const handleDragEnd = () => {
    if (dragIndex !== null && dropIndex !== null && dragIndex !== dropIndex) {
      onReorder(dragIndex, dropIndex);
    }
    setDragIndex(null);
    setDropIndex(null);
  };

  if (operators.length === 0) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Pipeline
          </h3>
        </div>
        <div className="text-center py-8 text-muted-foreground">
          <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No operators added</p>
          <p className="text-xs mt-1">Click an operator above to add it</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Layers className="w-4 h-4" />
          Pipeline ({operators.length})
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={onClear}
          title="Clear pipeline"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="space-y-2">
        {operators.map((operator, index) => (
          <OperatorCard
            key={operator.id}
            operator={operator}
            index={index}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onToggle={onToggle}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            isDragging={dragIndex === index}
          />
        ))}
      </div>
    </div>
  );
}
