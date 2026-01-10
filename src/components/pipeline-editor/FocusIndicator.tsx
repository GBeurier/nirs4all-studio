/**
 * FocusIndicator Component
 *
 * Visual indicator showing which panel currently has keyboard focus.
 * Part of Phase 5: UX Polish
 */

import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "@/lib/motion";
import type { PanelFocus } from "@/hooks/useKeyboardNavigation";

export interface FocusIndicatorProps {
  focusedPanel: PanelFocus;
  isActive: boolean;
  className?: string;
}

// Indicator ring for focused panels
export function FocusPanelRing({
  isFocused,
  color = "primary",
  className,
}: {
  isFocused: boolean;
  color?: "primary" | "blue" | "emerald" | "purple";
  className?: string;
}) {
  const colorClasses = {
    primary: "ring-primary/50 border-primary/30",
    blue: "ring-blue-500/50 border-blue-500/30",
    emerald: "ring-emerald-500/50 border-emerald-500/30",
    purple: "ring-purple-500/50 border-purple-500/30",
  };

  return (
    <AnimatePresence>
      {isFocused && (
        <motion.div
          className={cn(
            "absolute inset-0 pointer-events-none z-10 rounded-lg ring-2 border-2",
            colorClasses[color],
            className
          )}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
        />
      )}
    </AnimatePresence>
  );
}

// Focus badge showing current panel
export function FocusBadge({
  focusedPanel,
  className,
}: {
  focusedPanel: PanelFocus;
  className?: string;
}) {
  const panelLabels: Record<PanelFocus, { label: string; color: string }> = {
    palette: { label: "Palette", color: "bg-blue-500" },
    tree: { label: "Pipeline", color: "bg-emerald-500" },
    config: { label: "Config", color: "bg-purple-500" },
  };

  const { label, color } = panelLabels[focusedPanel];

  return (
    <motion.div
      key={focusedPanel}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white",
        color,
        className
      )}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.2 }}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-white/50 animate-pulse" />
      {label} focused
    </motion.div>
  );
}

// Navigation hint for current panel
export function NavigationHint({
  focusedPanel,
  className,
}: {
  focusedPanel: PanelFocus;
  className?: string;
}) {
  const hints: Record<PanelFocus, string> = {
    palette: "Search or click to add steps",
    tree: "Use ↑↓ to navigate, Enter to configure",
    config: "Tab through fields, Esc to return",
  };

  return (
    <motion.p
      key={focusedPanel}
      className={cn("text-xs text-muted-foreground", className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {hints[focusedPanel]}
    </motion.p>
  );
}

// Keyboard navigation status bar
export function NavigationStatusBar({
  focusedPanel,
  selectedStepName,
  className,
}: {
  focusedPanel: PanelFocus;
  selectedStepName?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 text-xs", className)}>
      {/* Panel indicator */}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Panel:</span>
        <FocusBadge focusedPanel={focusedPanel} />
      </div>

      {/* Selected step */}
      {selectedStepName && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground/50">•</span>
          <span className="text-muted-foreground">Selected:</span>
          <span className="font-medium text-foreground">{selectedStepName}</span>
        </div>
      )}

      {/* Hint */}
      <div className="flex-1" />
      <NavigationHint focusedPanel={focusedPanel} />
    </div>
  );
}

// Step highlight animation for keyboard navigation
export function StepNavigationHighlight({
  isHighlighted,
  children,
  className,
}: {
  isHighlighted: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={cn("relative", className)}
      animate={isHighlighted ? { scale: [1, 1.02, 1] } : {}}
      transition={{ duration: 0.2 }}
    >
      {isHighlighted && (
        <motion.div
          className="absolute inset-0 rounded-lg bg-primary/10 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
      )}
      {children}
    </motion.div>
  );
}

export default FocusPanelRing;
