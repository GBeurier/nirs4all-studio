import type { TFunction } from "i18next";

export {
  buildResultAnalysisMetadataFacetItems as buildInspectorSidebarMetadataFacetItems,
  buildResultAnalysisMetadataFacetQuery as buildInspectorSidebarMetadataFacetQuery,
} from "@/lib/inspector/resultAnalysisMetadataFacetReadModel";
export type {
  BuildResultAnalysisMetadataFacetItemsOptions as BuildInspectorSidebarMetadataFacetItemsOptions,
  ResultAnalysisMetadataFacetItem as InspectorSidebarMetadataFacetItem,
  ResultAnalysisMetadataFacetQuery as InspectorSidebarMetadataFacetQuery,
  ResultAnalysisMetadataFacetSelection as InspectorSidebarMetadataFacetSelection,
  ResultAnalysisMetadataFacetValueItem as InspectorSidebarMetadataFacetValueItem,
} from "@/lib/inspector/resultAnalysisMetadataFacetReadModel";

export type InspectorSidebarStatusLabel = 'error' | 'loading' | 'noData' | 'ready';

interface InspectorSidebarStatusInput {
  error?: string | null;
  isLoading: boolean;
  chainCount: number;
}

interface SelectAllStateInput {
  availableChainCount: number;
  selectedCount: number;
  totalChains: number;
}

export function getInspectorSidebarStatusLabel({
  error,
  isLoading,
  chainCount,
}: InspectorSidebarStatusInput): InspectorSidebarStatusLabel {
  if (error) return 'error';
  if (isLoading) return 'loading';
  if (chainCount === 0) return 'noData';
  return 'ready';
}

export function getInspectorSelectionSubtitle(pinnedCount: number, t: TFunction): string {
  return pinnedCount > 0
    ? t('inspector.counts.pinned', { count: pinnedCount })
    : t('inspector.sidebar.selectionSubtitle.activeChains');
}

export function isInspectorSelectAllDisabled({
  availableChainCount,
  selectedCount,
  totalChains,
}: SelectAllStateInput): boolean {
  return availableChainCount === 0 || selectedCount === totalChains;
}
