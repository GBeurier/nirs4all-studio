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

import { Trans, useTranslation } from "react-i18next";
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
  navigation: { icon: Navigation },
  panels: { icon: Layout },
  editing: { icon: Edit },
  actions: { icon: Zap },
} as const;

// Shortcut descriptions are authored in English in `useKeyboardNavigation`; map them to locale keys.
const SHORTCUT_DESCRIPTION_KEYS: Record<string, string> = {
  "Select previous step": "pipelineEditor.shortcuts.descriptions.selectPrevious",
  "Select next step": "pipelineEditor.shortcuts.descriptions.selectNext",
  "Navigate into branch": "pipelineEditor.shortcuts.descriptions.navigateIntoBranch",
  "Navigate out of branch": "pipelineEditor.shortcuts.descriptions.navigateOutOfBranch",
  "Configure selected step": "pipelineEditor.shortcuts.descriptions.configureStep",
  "Deselect / Close dialogs": "pipelineEditor.shortcuts.descriptions.deselect",
  "Cycle to next panel": "pipelineEditor.shortcuts.descriptions.nextPanel",
  "Cycle to previous panel": "pipelineEditor.shortcuts.descriptions.previousPanel",
  "Open command palette": "pipelineEditor.shortcuts.descriptions.openCommandPalette",
  "Show keyboard shortcuts": "pipelineEditor.shortcuts.descriptions.showShortcuts",
  "Duplicate selected step": "pipelineEditor.shortcuts.descriptions.duplicateStep",
  "Delete selected step": "pipelineEditor.shortcuts.descriptions.deleteStep",
  "Add branch to selected step": "pipelineEditor.shortcuts.descriptions.addBranch",
  Undo: "pipelineEditor.shortcuts.descriptions.undo",
  Redo: "pipelineEditor.shortcuts.descriptions.redo",
  "Save pipeline": "pipelineEditor.shortcuts.descriptions.savePipeline",
};

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
function formatKey(key: string, spaceLabel: string): string {
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
    " ": spaceLabel,
  };

  return keyMap[key] ?? key;
}

// Format shortcut display with modifiers
function ShortcutDisplay({ shortcut }: { shortcut: KeyboardShortcut }) {
  const { t } = useTranslation();
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
      {formatKey(shortcut.key, t("pipelineEditor.shortcuts.space"))}
    </kbd>
  );

  return <div className="flex items-center">{parts}</div>;
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  const { t } = useTranslation();
  const groupedShortcuts = groupShortcutsByCategory(KEYBOARD_SHORTCUTS);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            {t("pipelineEditor.shortcuts.title")}
          </DialogTitle>
          <DialogDescription>
            {t("pipelineEditor.shortcuts.subtitle")}
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
                  <h3 className="text-sm font-semibold">{t(`pipelineEditor.shortcuts.categories.${categoryKey}.label`)}</h3>
                  <span className="text-xs text-muted-foreground">
                    — {t(`pipelineEditor.shortcuts.categories.${categoryKey}.description`)}
                  </span>
                </div>

                <div className="grid gap-2">
                  {shortcuts.map((shortcut, index) => (
                    <div
                      key={`${shortcut.key}-${index}`}
                      className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm text-foreground">
                        {SHORTCUT_DESCRIPTION_KEYS[shortcut.description] ? t(SHORTCUT_DESCRIPTION_KEYS[shortcut.description]) : shortcut.description}
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
          <h4 className="text-sm font-medium text-primary mb-2">💡 {t("pipelineEditor.shortcuts.tipsTitle")}</h4>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• <Trans i18nKey="pipelineEditor.shortcuts.tipCommand" components={{ kbd: <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px] font-mono" /> }} /></li>
            <li>• {t("pipelineEditor.shortcuts.tipArrows")}</li>
            <li>• <Trans i18nKey="pipelineEditor.shortcuts.tipExpand" components={{ kbd: <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px] font-mono" /> }} /></li>
            <li>• <Trans i18nKey="pipelineEditor.shortcuts.tipTab" components={{ kbd: <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px] font-mono" /> }} /></li>
          </ul>
        </div>

        {/* Platform Note */}
        <p className="text-xs text-muted-foreground text-center mt-4">
          <Trans i18nKey="pipelineEditor.shortcuts.platformNote" components={{ kbd: <kbd className="px-1 py-0.5 bg-muted border border-border rounded text-[10px] font-mono" /> }} />
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default KeyboardShortcutsDialog;
