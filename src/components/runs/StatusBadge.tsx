import { RuntimeStatusBadge } from "@/components/runtime";
import type { RunStatus } from "@/types/runs";

export function StatusBadge({ status }: { status: RunStatus }) {
  return <RuntimeStatusBadge status={status} variant="secondary" />;
}
