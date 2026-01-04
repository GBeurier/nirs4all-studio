/**
 * NodeActions - Quick action buttons for tree nodes
 *
 * Extracted from TreeNode to provide consistent action button styling.
 * Shows on hover for duplicate and delete operations.
 */

import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NodeActionsProps {
  onDuplicate: () => void;
  onRemove: () => void;
  visible?: boolean;
}

/**
 * Quick action buttons that appear on node hover
 */
export function NodeActions({ onDuplicate, onRemove, visible = true }: NodeActionsProps) {
  if (!visible) return null;

  return (
    <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
      >
        <Copy className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
