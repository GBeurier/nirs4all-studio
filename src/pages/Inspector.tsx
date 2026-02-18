/**
 * Inspector — Prediction Explorer & Model Performance Analyzer
 *
 * Provider nesting: Session > Data > Selection > Filter > Color > View
 * Session wraps everything so inner contexts can save/restore state.
 */

import { InspectorSessionProvider } from '@/context/InspectorSessionContext';
import { InspectorDataProvider } from '@/context/InspectorDataContext';
import { InspectorSelectionProvider } from '@/context/InspectorSelectionContext';
import { InspectorFilterProvider } from '@/context/InspectorFilterContext';
import { InspectorColorProvider } from '@/context/InspectorColorContext';
import { InspectorViewProvider } from '@/context/InspectorViewContext';
import { InspectorSidebar } from '@/components/inspector/InspectorSidebar';
import { InspectorCanvas } from '@/components/inspector/InspectorCanvas';

export default function Inspector() {
  return (
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
  );
}

function InspectorContent() {
  return (
    <div className="h-full flex -m-6">
      <InspectorSidebar />
      <InspectorCanvas />
    </div>
  );
}
