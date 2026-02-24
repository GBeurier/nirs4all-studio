/**
 * Inspector — Prediction Explorer & Model Performance Analyzer
 *
 * Provider nesting: Session > Data > Selection > Filter > Color > View
 * Session wraps everything so inner contexts can save/restore state.
 */

import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { InspectorSessionProvider } from '@/context/InspectorSessionContext';
import { InspectorDataProvider } from '@/context/InspectorDataContext';
import { InspectorSelectionProvider } from '@/context/InspectorSelectionContext';
import { InspectorFilterProvider } from '@/context/InspectorFilterContext';
import { InspectorColorProvider } from '@/context/InspectorColorContext';
import { InspectorViewProvider } from '@/context/InspectorViewContext';
import { InspectorSidebar } from '@/components/inspector/InspectorSidebar';
import { InspectorCanvas } from '@/components/inspector/InspectorCanvas';
import { SourceFilterBar } from '@/components/inspector/SourceFilterBar';

export default function Inspector() {
  return (
    <MlLoadingOverlay>
    <InspectorSessionProvider>
      <InspectorDataProvider>
        <InspectorSelectionProvider>
          <InspectorFilterProvider>
            <InspectorColorProvider>
              <InspectorViewProvider>
                <InspectorContent />
              </InspectorViewProvider>
            </InspectorColorProvider>
          </InspectorFilterProvider>
        </InspectorSelectionProvider>
      </InspectorDataProvider>
    </InspectorSessionProvider>
    </MlLoadingOverlay>
  );
}

function InspectorContent() {
  return (
    <div className="h-full flex flex-col -m-6">
      <SourceFilterBar />
      <div className="flex-1 flex min-h-0">
        <InspectorSidebar />
        <InspectorCanvas />
      </div>
    </div>
  );
}
