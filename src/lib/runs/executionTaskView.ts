import type {
  RunsExecutionTaskGroup,
  RunsExecutionTaskItem,
} from "@/lib/runs/pageData";

export const GROUPED_EXECUTION_JOB_PREVIEW_COUNT = 3;

export function isOrphanedExecutionTask(item: RunsExecutionTaskItem): boolean {
  return item.isOrphaned;
}

export function getExecutionTaskItemKey(item: RunsExecutionTaskItem): string {
  return `${item.jobId}:${item.runId}:${item.createdAt}:${item.executionStatus}`;
}

export function getExecutionTaskGroupKey(group: RunsExecutionTaskGroup): string {
  return group.groupId;
}

export function getVisibleExecutionTaskItems(items: readonly RunsExecutionTaskItem[]): RunsExecutionTaskItem[] {
  const visibleItems = items.slice(0, 4);
  const visibleKeys = new Set(visibleItems.map(getExecutionTaskItemKey));

  for (const item of items) {
    if (visibleItems.length >= 6) break;
    if (!isOrphanedExecutionTask(item)) continue;

    const key = getExecutionTaskItemKey(item);
    if (!visibleKeys.has(key)) {
      visibleItems.push(item);
      visibleKeys.add(key);
    }
  }

  return visibleItems;
}

export function getVisibleExecutionTaskGroups(groups: readonly RunsExecutionTaskGroup[]): RunsExecutionTaskGroup[] {
  return groups.filter(group => group.totalCount > 1).slice(0, 3);
}
