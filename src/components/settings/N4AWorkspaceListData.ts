import type {
  LinkedWorkspace,
  WorkspaceDiscoveredCounts,
} from "@/types/linked-workspaces";
import { formatRelativeTime } from "@/utils/formatters";

export type DiscoveredCountKey = "runs" | "exports" | "datasets" | "templates";

type CountDefinition = {
  key: DiscoveredCountKey;
  countKey: keyof WorkspaceDiscoveredCounts;
  singular: string;
  plural: string;
};

export type DiscoveredCountItem = {
  key: DiscoveredCountKey;
  count: number;
  label: string;
};

export type WorkspaceItemState = {
  containerClassName: string;
  activeBadge: {
    label: string;
    variant: "default";
    className: string;
  } | null;
};

export const DEFAULT_DISCOVERED_COUNTS: WorkspaceDiscoveredCounts = {
  runs_count: 0,
  datasets_count: 0,
  exports_count: 0,
  templates_count: 0,
};

const DISCOVERED_COUNT_DEFINITIONS: CountDefinition[] = [
  { key: "runs", countKey: "runs_count", singular: "run", plural: "runs" },
  { key: "exports", countKey: "exports_count", singular: "export", plural: "exports" },
  { key: "datasets", countKey: "datasets_count", singular: "dataset", plural: "datasets" },
  { key: "templates", countKey: "templates_count", singular: "template", plural: "templates" },
];

const ACTIVE_WORKSPACE_BADGE = {
  label: "Active",
  variant: "default",
  className: "text-xs",
} as const;

export const WORKSPACE_ACTION_COPY = {
  activate: {
    label: "Activate",
    tooltip: "Set as active workspace",
  },
  refresh: {
    tooltip: "Refresh list",
  },
  retry: {
    label: "Retry",
  },
  scan: {
    tooltip: "Rescan workspace",
  },
  unlink: {
    tooltip: "Unlink workspace",
    dialogTitle: "Unlink workspace?",
    dialogDescription: "This will remove the workspace from your linked list. The actual files will not be deleted.",
    cancelLabel: "Cancel",
    confirmLabel: "Unlink",
  },
} as const;

export function getDiscoveredCounts(
  discovered?: Partial<WorkspaceDiscoveredCounts> | null,
): WorkspaceDiscoveredCounts {
  return {
    runs_count: discovered?.runs_count ?? DEFAULT_DISCOVERED_COUNTS.runs_count,
    datasets_count: discovered?.datasets_count ?? DEFAULT_DISCOVERED_COUNTS.datasets_count,
    exports_count: discovered?.exports_count ?? DEFAULT_DISCOVERED_COUNTS.exports_count,
    templates_count: discovered?.templates_count ?? DEFAULT_DISCOVERED_COUNTS.templates_count,
  };
}

export function formatCountLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function getWorkspaceDiscoveredCountItems(
  discovered?: Partial<WorkspaceDiscoveredCounts> | null,
): DiscoveredCountItem[] {
  const counts = getDiscoveredCounts(discovered);

  return DISCOVERED_COUNT_DEFINITIONS.map((definition) => ({
    key: definition.key,
    count: counts[definition.countKey],
    label: formatCountLabel(
      counts[definition.countKey],
      definition.singular,
      definition.plural,
    ),
  }));
}

export function getLinkedWorkspaceCountLabel(count: number): string {
  return `${count} ${count === 1 ? "workspace" : "workspaces"} linked`;
}

export function getLastScannedLabel(
  lastScanned: string | null | undefined,
  relativeTimeFormatter: (dateString: string) => string = formatRelativeTime,
): string | null {
  if (!lastScanned) {
    return null;
  }

  return `Scanned ${relativeTimeFormatter(lastScanned)}`;
}

export function getScanSuccessMessage(
  discovered?: Partial<WorkspaceDiscoveredCounts> | null,
): string {
  const counts = getDiscoveredCounts(discovered);

  return `Scanned: ${formatCountLabel(counts.runs_count, "run")}, ${formatCountLabel(
    counts.exports_count,
    "export",
  )}`;
}

export function getWorkspaceItemState(
  workspace: Pick<LinkedWorkspace, "is_active">,
): WorkspaceItemState {
  if (workspace.is_active) {
    return {
      containerClassName: "p-4 rounded-lg border transition-colors bg-primary/5 border-primary/30",
      activeBadge: ACTIVE_WORKSPACE_BADGE,
    };
  }

  return {
    containerClassName: "p-4 rounded-lg border transition-colors bg-card hover:bg-muted/50",
    activeBadge: null,
  };
}
