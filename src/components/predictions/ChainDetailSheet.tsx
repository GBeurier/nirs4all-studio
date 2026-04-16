/**
 * ChainDetailSheet — slide-over shell around ChainDetailPanel.
 *
 * Chain-id driven: caller passes `chainId` (+ optional loading-state
 * metadata hints); the panel fetches the full ChainSummary internally.
 */

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type {
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import {
  ChainDetailPanel,
  type ChainDetailFocus,
  type ChainDetailMetaHint,
} from "./detail/ChainDetailPanel";

interface ChainDetailSheetProps {
  /** Chain id to display; null closes / renders nothing. */
  chainId: string | null;
  /** Optional metric used to resolve primary scores server-side. */
  metric?: string | null;
  /**
   * Lightweight metadata rendered in the header while the ChainSummary
   * fetch is in flight. All fields optional — the fetched summary takes
   * over once resolved.
   */
  metaHint?: ChainDetailMetaHint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional focus context from the originating row/card. Lets the shared
   * detail panel open on the relevant refit / CV / fold instead of always
   * falling back to the generic default selection.
   */
  focus?: ChainDetailFocus;
  /**
   * Invoked when the user clicks "Customize" on a chart tile or the
   * per-row viewer icon in the folds table — should open the full
   * PredictionViewer at the page level (on top of this sheet).
   */
  onOpenViewer?: (
    partitions: ViewerPartitionTarget[],
    header: ViewerHeader,
    kind: ChartKind,
  ) => void;
}

export function ChainDetailSheet({
  chainId,
  metric,
  metaHint,
  open,
  onOpenChange,
  focus,
  onOpenViewer,
}: ChainDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1180px,86vw)] xl:max-w-[1240px]"
      >
        <SheetTitle className="sr-only">
          {metaHint?.modelName || metaHint?.modelClass || "Prediction details"}
        </SheetTitle>
        {chainId && (
          <ChainDetailPanel
            key={chainId}
            chainId={chainId}
            metric={metric ?? null}
            metaHint={metaHint}
            focus={focus}
            onOpenViewer={onOpenViewer}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
