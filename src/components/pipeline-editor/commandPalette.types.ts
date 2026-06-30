/**
 * CommandPalette read-models & shared types.
 *
 * Kept separate from the React component so the pure command-building,
 * filtering and grouping helpers (commandPaletteData.ts) and the item
 * renderer (CommandPaletteItem.tsx) can share them without importing JSX.
 *
 * Boundary note: these describe *editor-side* command read-models only.
 * Future backend-aware palettes (dag-ml operators, compute options, WASM)
 * should add new categories/builders here rather than re-typing actions
 * inside the component. See docs/ARCHITECTURE_BOUNDARIES.md.
 */

import type { LucideIcon } from "lucide-react";
import type { PipelineStep } from "./types";

/** Category buckets a command is grouped under in the palette. */
export type CommandCategory =
  | "step"
  | "navigation"
  | "action"
  | "pipeline"
  | "add-step";

/** A single selectable command rendered in the palette. */
export interface CommandAction {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  icon: LucideIcon;
  iconColor?: string;
  keywords?: string[];
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
}

/** A pipeline step flattened with its human-readable navigation path. */
export interface FlattenedStep {
  step: PipelineStep;
  path: string;
}
