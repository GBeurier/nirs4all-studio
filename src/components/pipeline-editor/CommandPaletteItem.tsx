/**
 * CommandPaletteItem — presentational renderer for a single command row.
 *
 * Pure presentation: icon, label, optional description, optional shortcut.
 * Kept separate so CommandPalette.tsx stays orchestration + state and future
 * palettes can reuse the exact same row rendering.
 */

import { CommandItem } from "@/components/ui/command";
import type { CommandAction } from "./commandPalette.types";

export function CommandPaletteItem({ action }: { action: CommandAction }) {
  const Icon = action.icon;

  return (
    <CommandItem
      value={action.id}
      onSelect={action.onSelect}
      disabled={action.disabled}
      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
    >
      <Icon className={`h-4 w-4 flex-shrink-0 ${action.iconColor ?? "text-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate">{action.label}</span>
        </div>
        {action.description && (
          <p className="text-xs text-muted-foreground truncate">{action.description}</p>
        )}
      </div>
      {action.shortcut && (
        <kbd className="ml-auto text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {action.shortcut}
        </kbd>
      )}
    </CommandItem>
  );
}

export default CommandPaletteItem;
