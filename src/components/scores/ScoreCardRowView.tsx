import { ScoreCardInlineRow } from "./ScoreCardInlineRow";
import { ScoreCardTableRow } from "./ScoreCardTableRow";
import type { ScoreCardRowViewProps } from "./ScoreCardRowViewProps";

export function ScoreCardRowView(props: ScoreCardRowViewProps) {
  if (props.variant === "table-row") {
    return <ScoreCardTableRow {...props} />;
  }
  return <ScoreCardInlineRow {...props} />;
}
