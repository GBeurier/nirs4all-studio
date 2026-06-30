export interface SplitRuntimeMetadata {
  groupRequired: boolean;
  groupHandling: 'native' | 'wrapper';
  runtimeOnlyParams?: string[];
}

export interface UnifiedOperatorFilterStats {
  removed_count: number;
  reason?: string;
  mode?: 'remove' | 'tag';
}
