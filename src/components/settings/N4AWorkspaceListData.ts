import type { TFunction } from "i18next";

import type {
  LinkedWorkspace,
  WorkspaceDiscoveredCounts,
} from "@/types/linked-workspaces";
import { formatRelativeTime } from "@/utils/formatters";

export type DiscoveredCountKey = "runs" | "exports" | "datasets" | "templates";

type CountDefinition = {
  key: DiscoveredCountKey;
  countKey: keyof WorkspaceDiscoveredCounts;
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
  { key: "runs", countKey: "runs_count" },
  { key: "exports", countKey: "exports_count" },
  { key: "datasets", countKey: "datasets_count" },
  { key: "templates", countKey: "templates_count" },
];

export function getWorkspaceActionCopy(t: TFunction) {
  return {
    activate: {
      label: t("settings.n4aWorkspaces.activate"),
      tooltip: t("settings.n4aWorkspaces.activateTooltip"),
    },
    refresh: {
      tooltip: t("settings.n4aWorkspaces.refreshTooltip"),
    },
    retry: {
      label: t("common.retry"),
    },
    scan: {
      tooltip: t("settings.n4aWorkspaces.scanTooltip"),
    },
    unlink: {
      tooltip: t("settings.n4aWorkspaces.unlinkTooltip"),
      dialogTitle: t("settings.n4aWorkspaces.unlinkTitle"),
      dialogDescription: t("settings.n4aWorkspaces.unlinkDescription"),
      cancelLabel: t("common.cancel"),
      confirmLabel: t("settings.n4aWorkspaces.unlink"),
    },
  } as const;
}

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

function getCountLabel(key: DiscoveredCountKey, count: number, t: TFunction): string {
  switch (key) {
    case "runs":
      return t("settings.n4aWorkspaces.counts.runs", { count });
    case "exports":
      return t("settings.n4aWorkspaces.counts.exports", { count });
    case "datasets":
      return t("settings.n4aWorkspaces.counts.datasets", { count });
    case "templates":
      return t("settings.n4aWorkspaces.counts.templates", { count });
  }
}

export function getWorkspaceDiscoveredCountItems(
  discovered: Partial<WorkspaceDiscoveredCounts> | null | undefined,
  t: TFunction,
): DiscoveredCountItem[] {
  const counts = getDiscoveredCounts(discovered);

  return DISCOVERED_COUNT_DEFINITIONS.map((definition) => ({
    key: definition.key,
    count: counts[definition.countKey],
    label: getCountLabel(definition.key, counts[definition.countKey], t),
  }));
}

export function getLinkedWorkspaceCountLabel(count: number, t: TFunction): string {
  return t("settings.n4aWorkspaces.linkedCount", { count });
}

export function getLastScannedLabel(
  lastScanned: string | null | undefined,
  t: TFunction,
  relativeTimeFormatter: (dateString: string) => string = formatRelativeTime,
): string | null {
  if (!lastScanned) {
    return null;
  }

  return t("settings.n4aWorkspaces.scanned", { time: relativeTimeFormatter(lastScanned) });
}

export function getScanSuccessMessage(
  discovered: Partial<WorkspaceDiscoveredCounts> | null | undefined,
  t: TFunction,
): string {
  const counts = getDiscoveredCounts(discovered);

  return t("settings.n4aWorkspaces.scanSuccess", {
    runs: getCountLabel("runs", counts.runs_count, t),
    exports: getCountLabel("exports", counts.exports_count, t),
  });
}

export function getWorkspaceItemState(
  workspace: Pick<LinkedWorkspace, "is_active">,
  t: TFunction,
): WorkspaceItemState {
  if (workspace.is_active) {
    return {
      containerClassName: "p-4 rounded-lg border transition-colors bg-primary/5 border-primary/30",
      activeBadge: { label: t("common.active"), variant: "default", className: "text-xs" },
    };
  }

  return {
    containerClassName: "p-4 rounded-lg border transition-colors bg-card hover:bg-muted/50",
    activeBadge: null,
  };
}
