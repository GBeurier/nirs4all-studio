/**
 * KeyboardShortcutsDialog Component
 *
 * A dialog displaying all available keyboard shortcuts for the Pipeline Editor.
 * Organized by category for easy reference.
 *
 * Activated with Cmd+? (or Ctrl+?)
 *
 * Part of Phase 5: UX Polish
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Keyboard,
  Navigation,
  Edit,
  Zap,
  Layout,
} from "lucide-react";
import {
  KEYBOARD_SHORTCUTS,
  type KeyboardShortcut,
} from "@/hooks/useKeyboardNavigation";

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Category configuration with icons and labels
const categoryConfig = {
  navigation: {
    label: "Navigation",
    icon: Navigation,
    description: "Move between steps and branches",
  },
  panels: {
    label: "Panels",
    icon: Layout,
    description: "Switch between editor panels",
  },
  editing: {
    label: "Editing",
    icon: Edit,
    description: "Modify pipeline steps",
  },
  actions: {
    label: "Actions",
    icon: Zap,
    description: "General commands",
  },
} as const;

type CategoryKey = keyof typeof categoryConfig;

// Group shortcuts by category
function groupShortcutsByCategory(shortcuts: KeyboardShortcut[]): Record<CategoryKey, KeyboardShortcut[]> {
  const groups: Record<CategoryKey, KeyboardShortcut[]> = {
    navigation: [],
    panels: [],
    editing: [],
    actions: [],
  };

  for (const shortcut of shortcuts) {
    const category = shortcut.category as CategoryKey;
    if (groups[category]) {
      groups[category].push(shortcut);
    }
  }

  return groups;
}

// Format key display
function formatKey(key: string): string {
  const keyMap: Record<string, string> = {
    "↑": "↑",
    "↓": "↓",
    "←": "←",
    "→": "→",
    "Tab": "Tab",
    "Enter": "↵",
    "Escape": "Esc",
    "Delete": "Del",
    "Backspace": "⌫",
    " ": "Space",
  };

  return keyMap[key] ?? key;
}

// Format shortcut display with modifiers
function ShortcutDisplay({ shortcut }: { shortcut: KeyboardShortcut }) {
  const parts: React.ReactNode[] = [];

  if (shortcut.modifiers?.includes("ctrl")) {
    parts.push(
      <kbd key="ctrl" className="px-1.5 py-0.5 bg-muted border border-border rounded text-[11px] font-mono">
        ⌘
      </kbd>
    );
    parts.push(<span key="sep1" className="mx-0.5 text-muted-foreground">+</span>);
  }

  if (shortcut.modifiers?.includes("shift")) {
    parts.push(
      <kbd key="shift" className="px-1.5 py-0.5 bg-muted border border-border rounded text-[11px] font-mono">
        ⇧
      </kbd>
    );
    parts.push(<span key="sep2" className="mx-0.5 text-muted-foreground">+</span>);
  }

  if (shortcut.modifiers?.includes("alt")) {
    parts.push(
      <kbd key="alt" className="px-1.5 py-0.5 bg-muted border border-border rounded text-[11px] font-mono">
        ⌥
      </kbd>
    );
    parts.push(<span key="sep3" className="mx-0.5 text-muted-foreground">+</span>);
  }

  parts.push(
    <kbd key="key" className="px-1.5 py-0.5 bg-muted border border-border rounded text-[11px] font-mono min-w-[24px] text-center">
      {formatKey(shortcut.key)}
    </kbd>
  );

  return <div className="flex items-center">{parts}</div>;
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  const groupedShortcuts = groupShortcutsByCategory(KEYBOARD_SHORTCUTS);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Quick reference for all available keyboard shortcuts in the Pipeline Editor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {(Object.keys(categoryConfig) as CategoryKey[]).map((categoryKey) => {
            const config = categoryConfig[categoryKey];
            const shortcuts = groupedShortcuts[categoryKey];
            const Icon = config.icon;

            if (shortcuts.length === 0) return null;

            return (
              <div key={categoryKey}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">{config.label}</h3>
                  <span className="text-xs text-muted-foreground">
                    — {config.description}
                  </span>
                </div>

                <div className="grid gap-2">
                  {shortcuts.map((shortcut, index) => (
                    <div
                      key={`${shortcut.key}-${index}`}
                      className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm text-foreground">
                        {shortcut.description}
                      </span>
                      <ShortcutDisplay shortcut={shortcut} />
                    </div>
                  ))}
                </div>

                {categoryKey !== "actions" && <Separator className="mt-4" />}
              </div>
            );
          })}
        </div>

        {/* Tips Section */}
        <div className="mt-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
          <h4 className="text-sm font-medium text-primary mb-2">💡 Pro Tips</h4>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Use <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px] font-mono">⌘K</kbd> to quickly access any command</li>
            <li>• Arrow keys navigate steps when the tree panel is focused</li>
            <li>• Press <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px] font-mono">→</kbd> to expand branches, <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px] font-mono">←</kbd> to collapse</li>
            <li>• <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px] font-mono">Tab</kbd> cycles between Palette → Tree → Config panels</li>
          </ul>
        </div>

        {/* Platform Note */}
        <p className="text-xs text-muted-foreground text-center mt-4">
          On Windows/Linux, use <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px] font-mono">Ctrl</kbd> instead of <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px] font-mono">⌘</kbd>
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default KeyboardShortcutsDialog;
