/**
 * ChainDetailSheet — slide-over shell around ChainDetailPanel.
 *
 * Chain-id driven: caller passes `chainId` (+ optional loading-state
 * metadata hints); the panel fetches the full ChainSummary internally.
 */

import { Sheet, SheetContent } from "@/components/ui/sheet";
import type {
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import {
  ChainDetailPanel,
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
  onOpenViewer,
}: ChainDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[min(960px,78vw)] xl:max-w-[1040px]"
      >
        {chainId && (
          <ChainDetailPanel
            key={chainId}
            chainId={chainId}
            metric={metric ?? null}
            metaHint={metaHint}
            onOpenViewer={onOpenViewer}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
