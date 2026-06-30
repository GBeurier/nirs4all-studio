import { memo } from 'react';

import { EmbeddingSelector } from './EmbeddingSelector';
import type { EmbeddingOverlayInput } from '@/lib/playground/chartInputs';

export interface MainCanvasEmbeddingOverlayProps {
  input: EmbeddingOverlayInput | null;
  visible: boolean;
  onToggleExpanded?: () => void;
}

export const MainCanvasEmbeddingOverlay = memo(function MainCanvasEmbeddingOverlay({
  input,
  visible,
  onToggleExpanded,
}: MainCanvasEmbeddingOverlayProps) {
  if (!visible || !input) {
    return null;
  }

  return (
    <div className="absolute top-24 right-6 z-30">
      <EmbeddingSelector
        embedding={input.embedding}
        partitions={input.partitions}
        targets={input.targets}
        sampleIds={input.sampleIds}
        embeddingMethod={input.embeddingMethod}
        expanded={false}
        onToggleExpanded={onToggleExpanded}
        useSelectionContext
        visible={visible}
      />
    </div>
  );
});
