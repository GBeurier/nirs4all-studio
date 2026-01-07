/**
 * Keyboard Shortcuts Reference Component
 *
 * Displays available keyboard shortcuts in a collapsible card format.
 *
 * Phase 2 Implementation
 * Phase 6: Added i18n translations
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Keyboard, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface ShortcutItem {
  keys: string[];
  descriptionKey: string;
}

interface ShortcutGroup {
  nameKey: string;
  shortcuts: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    nameKey: "shortcuts.categories.global",
    shortcuts: [
      { keys: ["Ctrl", "K"], descriptionKey: "shortcuts.keys.commandPalette" },
      { keys: ["Ctrl", "/"], descriptionKey: "shortcuts.keys.toggleSidebar" },
      { keys: ["Ctrl", ","], descriptionKey: "shortcuts.keys.openSettings" },
    ],
  },
  {
    nameKey: "shortcuts.categories.pipelineEditor",
    shortcuts: [
      { keys: ["Ctrl", "S"], descriptionKey: "shortcuts.keys.savePipeline" },
      { keys: ["Ctrl", "Z"], descriptionKey: "shortcuts.keys.undo" },
      { keys: ["Ctrl", "Shift", "Z"], descriptionKey: "shortcuts.keys.redo" },
      { keys: ["Delete"], descriptionKey: "shortcuts.keys.deleteStep" },
      { keys: ["Tab"], descriptionKey: "shortcuts.keys.nextPanel" },
    ],
  },
  {
    nameKey: "shortcuts.categories.playground",
    shortcuts: [
      { keys: ["Ctrl", "Enter"], descriptionKey: "shortcuts.keys.applyPipeline" },
      { keys: ["Ctrl", "E"], descriptionKey: "shortcuts.keys.exportData" },
    ],
  },
];

function KeyBadge({ keyName }: { keyName: string }) {
  return (
    <Badge
      variant="outline"
      className="font-mono text-xs px-1.5 py-0.5 bg-muted/50"
    >
      {keyName}
    </Badge>
  );
}

function ShortcutRow({ shortcut, t }: { shortcut: ShortcutItem; t: (key: string) => string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">
        {t(shortcut.descriptionKey)}
      </span>
      <div className="flex items-center gap-1">
        {shortcut.keys.map((key, index) => (
          <span key={key} className="flex items-center gap-1">
            <KeyBadge keyName={key} />
            {index < shortcut.keys.length - 1 && (
              <span className="text-muted-foreground text-xs">+</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface KeyboardShortcutsProps {
  /** Whether the component is initially expanded */
  defaultOpen?: boolean;
  /** Additional class name */
  className?: string;
}

export function KeyboardShortcuts({
  defaultOpen = false,
  className,
}: KeyboardShortcutsProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Card className={className}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <CardTitle className="flex items-center gap-2 text-base">
              <ChevronRight
                className={cn(
                  "h-4 w-4 transition-transform",
                  isOpen && "rotate-90"
                )}
              />
              <Keyboard className="h-5 w-5" />
              {t("shortcuts.title")}
            </CardTitle>
            <CardDescription>
              {t("shortcuts.description")}
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-6">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.nameKey}>
                <h4 className="text-sm font-medium mb-2">{t(group.nameKey)}</h4>
                <div className="space-y-1 pl-2 border-l-2 border-muted">
                  {group.shortcuts.map((shortcut, index) => (
                    <ShortcutRow key={index} shortcut={shortcut} t={t} />
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default KeyboardShortcuts;
