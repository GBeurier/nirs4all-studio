/**
 * Small inline SVG icon set so the wizard renders complete out of the box.
 * Hosts can override any icon through the `icons` prop on `DatasetBuilder`.
 */

import type { ReactNode } from "react";
import type { DatasetRole, SignalType } from "./types.js";

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export type BuilderIconKey =
  | DatasetRole
  | "check"
  | "warning"
  | "error"
  | "chevron"
  | "file"
  | "folder"
  | "upload"
  | "info"
  | "eye"
  | "arrow"
  | "spark"
  | SignalType;

export const DEFAULT_ICONS: Partial<Record<BuilderIconKey, ReactNode>> = {
  x: (
    <svg {...base}>
      <path d="M3 12h3l2-6 4 12 3-8 2 4h4" />
    </svg>
  ),
  y: (
    <svg {...base}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  ),
  metadata: (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11" />
    </svg>
  ),
  id: (
    <svg {...base}>
      <path d="M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  partition: (
    <svg {...base}>
      <path d="M4 12h10M14 12l-3-3M14 12l-3 3M18 5v14" />
    </svg>
  ),
  replicate: (
    <svg {...base}>
      <path d="M17 4v6h-6M7 20v-6h6" />
      <path d="M20 10a8 8 0 0 0-14-4M4 14a8 8 0 0 0 14 4" />
    </svg>
  ),
  group: (
    <svg {...base}>
      <circle cx="8" cy="9" r="3" />
      <circle cx="16" cy="9" r="3" />
      <path d="M3 20c0-3 2-5 5-5M21 20c0-3-2-5-5-5" />
    </svg>
  ),
  ignored: (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </svg>
  ),
  check: (
    <svg {...base}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  warning: (
    <svg {...base}>
      <path d="M12 3l9 16H3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  ),
  error: (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  ),
  chevron: (
    <svg {...base}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  file: (
    <svg {...base}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  ),
  folder: (
    <svg {...base}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  upload: (
    <svg {...base} width={22} height={22}>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  ),
  info: (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  ),
  eye: (
    <svg {...base}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  arrow: (
    <svg {...base}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  spark: (
    <svg {...base}>
      <path d="M12 3l1.8 4.9L18 9.6l-4.2 1.7L12 16l-1.8-4.7L6 9.6l4.2-1.7z" />
    </svg>
  ),
};

export function icon(
  key: BuilderIconKey,
  overrides?: Partial<Record<string, ReactNode>>,
): ReactNode {
  return overrides?.[key] ?? DEFAULT_ICONS[key] ?? null;
}
