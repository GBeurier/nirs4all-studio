import type { ExperimentLaunchState } from "@/lib/experimentLaunchState";

import { NewExperimentLaunchBlockingNoticeCard } from "./NewExperimentLaunchBlockingNoticeCard";

export interface NewExperimentLaunchBlockingNoticesProps {
  blockingNotices: ExperimentLaunchState["blockingNotices"];
}

export function NewExperimentLaunchBlockingNotices({
  blockingNotices,
}: NewExperimentLaunchBlockingNoticesProps) {
  if (blockingNotices.length === 0) return null;

  return (
    <div className="mx-auto max-w-md space-y-2 text-left">
      {blockingNotices.map((notice) => (
        <NewExperimentLaunchBlockingNoticeCard key={notice.id} notice={notice} />
      ))}
    </div>
  );
}
