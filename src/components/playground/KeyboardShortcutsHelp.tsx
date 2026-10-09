/**
 * KeyboardShortcutsHelp - Help overlay dialog showing all keyboard shortcuts
 *
 * Features:
 * - Full list of available shortcuts grouped by category
 * - Search/filter shortcuts
 * - Visual key combination display
 * - Triggered by ? key
 *
 * Phase 6: Performance & Polish
 */

import { useMemo, useState } from 'react';
import { Keyboard, Search, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  type KeyboardShortcut,
  type ShortcutCategory,
  CATEGORY_ORDER,
} from '@/hooks/usePlaygroundShortcuts';
import { Trans, useTranslation } from 'react-i18next';

// ============= Types =============

export interface KeyboardShortcutsHelpProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
  /** Shortcuts grouped by category */
  shortcutsByCategory: Record<ShortcutCategory, KeyboardShortcut[]>;
  /** All shortcuts flat list */
  shortcuts?: KeyboardShortcut[];
}

// ============= Sub-Components =============

interface KeyBadgeProps {
  keyName: string;
  className?: string;
}

function KeyBadge({ keyName, className }: KeyBadgeProps) {
  // Format key names for display
  const displayKey = useMemo(() => {
    const formatted = keyName
      .replace(/ctrl/i, '⌘')
      .replace(/shift/i, '⇧')
      .replace(/alt/i, '⌥')
      .replace(/escape/i, 'Esc')
      .replace(/backspace/i, '⌫')
      .replace(/delete/i, 'Del')
      .replace(/enter/i, '↵')
      .replace(/space/i, 'Space')
      .replace(/arrowup|up/i, '↑')
      .replace(/arrowdown|down/i, '↓')
      .replace(/arrowleft|left/i, '←')
      .replace(/arrowright|right/i, '→');

    // Capitalize first letter for regular keys
    if (formatted.length === 1) {
      return formatted.toUpperCase();
    }

    return formatted;
  }, [keyName]);

  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center px-2 py-0.5 min-w-[24px]',
        'text-xs font-medium font-mono',
        'bg-muted border border-border rounded shadow-sm',
        'text-muted-foreground',
        className
      )}
    >
      {displayKey}
    </kbd>
  );
}

interface KeyCombinationProps {
  keys: string;
  className?: string;
}

function KeyCombination({ keys, className }: KeyCombinationProps) {
  const keyParts = keys.split('+').map((k) => k.trim());

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {keyParts.map((key, index) => (
        <span key={index} className="flex items-center gap-0.5">
          <KeyBadge keyName={key} />
          {index < keyParts.length - 1 && (
            <span className="text-muted-foreground text-xs mx-0.5">+</span>
          )}
        </span>
      ))}
    </div>
  );
}

interface ShortcutRowProps {
  shortcut: KeyboardShortcut;
  highlight?: string;
}

function ShortcutRow({ shortcut, highlight }: ShortcutRowProps) {
  // Highlight matching text
  const highlightText = (text: string) => {
    if (!highlight) return text;

    const regex = new RegExp(`(${highlight})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-accent/50 transition-colors">
      <div className="flex-1 min-w-0 mr-4">
        <div className="text-sm font-medium">
          {highlightText(shortcut.label)}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {highlightText(shortcut.description)}
        </div>
      </div>
      <KeyCombination keys={shortcut.keys} />
    </div>
  );
}

interface ShortcutCategoryProps {
  category: ShortcutCategory;
  shortcuts: KeyboardShortcut[];
  highlight?: string;
}

function ShortcutCategorySection({ category, shortcuts, highlight }: ShortcutCategoryProps) {
  const { t } = useTranslation();
  if (shortcuts.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 py-2 px-3">
        <Badge variant="outline" className="text-xs">
          {t(`playground.shortcuts.categories.${category}`)}
        </Badge>
        <span className="text-[10px] text-muted-foreground">
          {t('playground.shortcuts.count', { count: shortcuts.length })}
        </span>
      </div>
      <div className="space-y-0.5">
        {shortcuts.map((shortcut) => (
          <ShortcutRow key={shortcut.id} shortcut={shortcut} highlight={highlight} />
        ))}
      </div>
    </div>
  );
}

// ============= Main Component =============

export function KeyboardShortcutsHelp({
  open,
  onOpenChange,
  shortcutsByCategory,
}: KeyboardShortcutsHelpProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  // Localised copy of the shortcuts (labels/descriptions are keyed by shortcut id)
  const localizedByCategory = useMemo(() => {
    const result = {} as Record<ShortcutCategory, KeyboardShortcut[]>;
    for (const [category, list] of Object.entries(shortcutsByCategory)) {
      result[category as ShortcutCategory] = list.map((s) => ({
        ...s,
        label: t(`playground.shortcuts.items.${s.id}.label`),
        description: t(`playground.shortcuts.items.${s.id}.description`),
      }));
    }
    return result;
  }, [shortcutsByCategory, t]);

  // Filter shortcuts based on search
  const filteredByCategory = useMemo(() => {
    if (!searchQuery.trim()) return localizedByCategory;

    const query = searchQuery.toLowerCase();
    const filtered: Record<ShortcutCategory, KeyboardShortcut[]> = {
      selection: [],
      navigation: [],
      pipeline: [],
      view: [],
      export: [],
      general: [],
    };

    Object.entries(localizedByCategory).forEach(([category, shortcuts]) => {
      filtered[category as ShortcutCategory] = shortcuts.filter(
        (s) =>
          s.label.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query) ||
          s.keys.toLowerCase().includes(query)
      );
    });

    return filtered;
  }, [localizedByCategory, searchQuery]);

  // Count total visible shortcuts
  const totalVisible = useMemo(
    () =>
      Object.values(filteredByCategory).reduce((sum, arr) => sum + arr.length, 0),
    [filteredByCategory]
  );

  // Clear search when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSearchQuery('');
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="w-5 h-5" />
            {t('playground.shortcuts.title')}
          </DialogTitle>
          <DialogDescription>
            {t('playground.shortcuts.description')}
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t('playground.shortcuts.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-8"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label={t('playground.shortcuts.clearSearch')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Results count when searching */}
        {searchQuery && (
          <div className="text-xs text-muted-foreground">
            {t('playground.shortcuts.found', { count: totalVisible })}
          </div>
        )}

        <Separator />

        {/* Shortcuts list */}
        <ScrollArea className="max-h-[50vh] pr-4">
          {totalVisible === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Keyboard className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">{t('playground.shortcuts.noMatch')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {CATEGORY_ORDER.map((category) => (
                <ShortcutCategorySection
                  key={category}
                  category={category}
                  shortcuts={filteredByCategory[category]}
                  highlight={searchQuery}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer tip */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
          <span><Trans i18nKey="playground.shortcuts.pressToShow" components={{ key: <KeyBadge keyName="?" /> }} /></span>
          <span><Trans i18nKey="playground.shortcuts.pressToClose" components={{ key: <KeyBadge keyName="Escape" /> }} /></span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default KeyboardShortcutsHelp;
