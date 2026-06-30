import type { ScoreCardRow } from "@/types/score-cards";

interface ScoreCardRowBaseProps {
  row: ScoreCardRow;
  selectedMetrics: string[];
  workspaceId?: string;
  rank?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onViewDetails?: () => void;
  onViewPrediction?: (predictionId: string) => void;
  onViewChart?: () => void;
}

export interface ScoreCardInlineRowProps extends ScoreCardRowBaseProps {
  expandable?: boolean;
  indent?: number;
}

export interface ScoreCardTableRowProps extends ScoreCardRowBaseProps {
  maxTableMetrics?: number;
}

export interface ScoreCardRowViewProps extends ScoreCardInlineRowProps, ScoreCardTableRowProps {
  variant: "inline" | "table-row";
}
