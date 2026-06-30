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

export type InspectorSidebarStatusLabel = 'Error' | 'Loading' | 'No data' | 'Ready';

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
  if (error) return 'Error';
  if (isLoading) return 'Loading';
  if (chainCount === 0) return 'No data';
  return 'Ready';
}

export function getInspectorSelectionSubtitle(pinnedCount: number): string {
  return pinnedCount > 0 ? `${pinnedCount} pinned` : 'active chains';
}

export function isInspectorSelectAllDisabled({
  availableChainCount,
  selectedCount,
  totalChains,
}: SelectAllStateInput): boolean {
  return availableChainCount === 0 || selectedCount === totalChains;
}
