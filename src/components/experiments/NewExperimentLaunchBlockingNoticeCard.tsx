import type { ExperimentLaunchState } from "@/lib/experimentLaunchState";

export type NewExperimentLaunchBlockingNotice =
  ExperimentLaunchState["blockingNotices"][number];

export interface NewExperimentLaunchBlockingNoticeCardProps {
  notice: NewExperimentLaunchBlockingNotice;
}

export function NewExperimentLaunchBlockingNoticeCard({
  notice,
}: NewExperimentLaunchBlockingNoticeCardProps) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
      <p className="font-medium text-destructive">{notice.title}</p>
      <p className="text-muted-foreground">{notice.message}</p>
    </div>
  );
}
