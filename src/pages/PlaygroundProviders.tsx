import type { ReactNode } from 'react';
import { NodeRegistryProvider, PipelineEditorPreferencesProvider } from '@/components/pipeline-editor/contexts';
import { FilterProvider } from '@/context/FilterContext';
import { OutliersProvider } from '@/context/OutliersContext';
import { PlaygroundViewProvider } from '@/context/PlaygroundViewContext';
import { ReferenceDatasetProvider } from '@/context/ReferenceDatasetContext';
import { SelectionProvider } from '@/context/SelectionContext';
import type { SpectralData } from '@/types/spectral';
import type { UnifiedOperator } from '@/types/playground';

interface PlaygroundProvidersProps {
  children: ReactNode;
  primaryData: SpectralData | null;
  operators: UnifiedOperator[];
}

export function PlaygroundProviders({
  children,
  primaryData,
  operators,
}: PlaygroundProvidersProps) {
  return (
    <PipelineEditorPreferencesProvider>
      <NodeRegistryProvider>
        <PlaygroundViewProvider>
          <SelectionProvider>
            <FilterProvider>
              <OutliersProvider>
                <ReferenceDatasetProvider primaryData={primaryData} operators={operators}>
                  {children}
                </ReferenceDatasetProvider>
              </OutliersProvider>
            </FilterProvider>
          </SelectionProvider>
        </PlaygroundViewProvider>
      </NodeRegistryProvider>
    </PipelineEditorPreferencesProvider>
  );
}
