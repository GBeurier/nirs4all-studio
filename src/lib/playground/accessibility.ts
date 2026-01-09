/**
 * Accessibility Utilities for Playground
 *
 * Phase 10: Polish & Performance
 *
 * This module provides utilities for accessibility compliance:
 * - Screen reader announcements
 * - Focus management
 * - Keyboard navigation helpers
 * - ARIA live region management
 */

// ============= Live Region Announcements =============

/**
 * Announce a message to screen readers using a live region
 * @param message - The message to announce
 * @param priority - 'polite' for non-urgent updates, 'assertive' for important changes
 */
export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  // Find or create the live region
  let liveRegion = document.getElementById('playground-live-region');

  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'playground-live-region';
    liveRegion.setAttribute('aria-live', priority);
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.className = 'sr-only'; // Visually hidden but accessible
    liveRegion.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
    document.body.appendChild(liveRegion);
  }

  // Update priority if different
  liveRegion.setAttribute('aria-live', priority);

  // Clear and set message (the clear ensures the change is detected)
  liveRegion.textContent = '';
  // Use setTimeout to ensure the DOM change is detected
  setTimeout(() => {
    liveRegion!.textContent = message;
  }, 100);
}

/**
 * Announce selection changes to screen readers
 */
export function announceSelectionChange(count: number, action: 'selected' | 'deselected' | 'cleared'): void {
  let message: string;
  if (action === 'cleared') {
    message = 'Selection cleared';
  } else if (action === 'deselected') {
    message = count === 1 ? '1 sample deselected' : `${count} samples deselected`;
  } else {
    message = count === 1 ? '1 sample selected' : `${count} samples selected`;
  }
  announceToScreenReader(message);
}

/**
 * Announce filter changes to screen readers
 */
export function announceFilterChange(filterType: string, newValue: string): void {
  announceToScreenReader(`${filterType} changed to ${newValue}`);
}

/**
 * Announce loading state changes
 */
export function announceLoadingState(isLoading: boolean, context?: string): void {
  const message = isLoading
    ? `Loading ${context || 'data'}...`
    : `${context || 'Data'} loaded`;
  announceToScreenReader(message, isLoading ? 'polite' : 'assertive');
}

// ============= Focus Management =============

/**
 * Trap focus within a container (for modals/dialogs)
 */
export function trapFocus(container: HTMLElement): () => void {
  const focusableElements = container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;

    if (event.shiftKey) {
      // Shift + Tab: go to last element if at first
      if (document.activeElement === firstElement) {
        event.preventDefault();
        lastElement?.focus();
      }
    } else {
      // Tab: go to first element if at last
      if (document.activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    }
  };

  container.addEventListener('keydown', handleKeyDown);

  // Focus first element
  firstElement?.focus();

  // Return cleanup function
  return () => {
    container.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Return focus to a stored element (for modals/dialogs)
 */
export function createFocusReturn(): {
  store: () => void;
  restore: () => void;
} {
  let storedElement: HTMLElement | null = null;

  return {
    store: () => {
      storedElement = document.activeElement as HTMLElement | null;
    },
    restore: () => {
      storedElement?.focus();
      storedElement = null;
    },
  };
}

// ============= Keyboard Navigation =============

/**
 * Arrow key navigation for list-like components
 */
export function handleArrowKeyNavigation(
  event: React.KeyboardEvent,
  items: HTMLElement[],
  currentIndex: number,
  onIndexChange: (newIndex: number) => void,
  options?: {
    wrap?: boolean;
    horizontal?: boolean;
  }
): void {
  const { wrap = true, horizontal = false } = options ?? {};

  const prevKey = horizontal ? 'ArrowLeft' : 'ArrowUp';
  const nextKey = horizontal ? 'ArrowRight' : 'ArrowDown';

  let newIndex = currentIndex;

  if (event.key === prevKey) {
    event.preventDefault();
    newIndex = currentIndex - 1;
    if (newIndex < 0) {
      newIndex = wrap ? items.length - 1 : 0;
    }
  } else if (event.key === nextKey) {
    event.preventDefault();
    newIndex = currentIndex + 1;
    if (newIndex >= items.length) {
      newIndex = wrap ? 0 : items.length - 1;
    }
  } else if (event.key === 'Home') {
    event.preventDefault();
    newIndex = 0;
  } else if (event.key === 'End') {
    event.preventDefault();
    newIndex = items.length - 1;
  } else {
    return;
  }

  if (newIndex !== currentIndex) {
    onIndexChange(newIndex);
    items[newIndex]?.focus();
  }
}

// ============= ARIA Helpers =============

/**
 * Generate a unique ID for ARIA relationships
 */
let ariaIdCounter = 0;
export function generateAriaId(prefix: string = 'aria'): string {
  return `${prefix}-${++ariaIdCounter}`;
}

/**
 * Create ARIA describedby text for complex controls
 */
export function getChartDescription(chartType: string, sampleCount: number, selectedCount: number): string {
  let description = `${chartType} visualization showing ${sampleCount} samples`;
  if (selectedCount > 0) {
    description += `, ${selectedCount} selected`;
  }
  return description;
}

// ============= Reduced Motion Support =============

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Get animation duration based on user preference
 */
export function getAnimationDuration(normalMs: number): number {
  return prefersReducedMotion() ? 0 : normalMs;
}

// ============= Color Contrast =============

/**
 * Check if a color has sufficient contrast with another
 * Uses WCAG 2.0 guidelines
 */
export function hasMinimumContrast(
  foreground: string,
  background: string,
  level: 'AA' | 'AAA' = 'AA'
): boolean {
  // Parse hex colors
  const parseHex = (hex: string): { r: number; g: number; b: number } => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 0, b: 0 };
  };

  // Calculate relative luminance
  const luminance = (color: { r: number; g: number; b: number }): number => {
    const [r, g, b] = [color.r, color.g, color.b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const fg = parseHex(foreground);
  const bg = parseHex(background);

  const l1 = luminance(fg);
  const l2 = luminance(bg);

  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

  // WCAG AA requires 4.5:1 for normal text, 3:1 for large text
  // WCAG AAA requires 7:1 for normal text, 4.5:1 for large text
  const threshold = level === 'AAA' ? 7 : 4.5;

  return ratio >= threshold;
}

// ============= Accessibility Audit Helper =============

export interface AccessibilityIssue {
  element: string;
  issue: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  recommendation: string;
}

/**
 * Run a basic accessibility audit on the current page
 * For development/testing purposes only
 */
export function runAccessibilityAudit(): AccessibilityIssue[] {
  const issues: AccessibilityIssue[] = [];

  // Check for images without alt text
  document.querySelectorAll('img:not([alt])').forEach(img => {
    issues.push({
      element: 'img',
      issue: 'Image missing alt attribute',
      severity: 'serious',
      recommendation: 'Add alt="" for decorative images or descriptive alt text',
    });
  });

  // Check for buttons without accessible names
  document.querySelectorAll('button').forEach(btn => {
    if (!btn.textContent?.trim() && !btn.getAttribute('aria-label')) {
      issues.push({
        element: 'button',
        issue: 'Button without accessible name',
        severity: 'critical',
        recommendation: 'Add aria-label or visible text content',
      });
    }
  });

  // Check for form inputs without labels
  document.querySelectorAll('input, select, textarea').forEach(input => {
    const id = input.getAttribute('id');
    const hasLabel = id && document.querySelector(`label[for="${id}"]`);
    const hasAriaLabel = input.getAttribute('aria-label');
    const hasAriaLabelledby = input.getAttribute('aria-labelledby');

    if (!hasLabel && !hasAriaLabel && !hasAriaLabelledby) {
      issues.push({
        element: input.tagName.toLowerCase(),
        issue: 'Form input without associated label',
        severity: 'serious',
        recommendation: 'Add <label for="id"> or aria-label',
      });
    }
  });

  // Check for links without href
  document.querySelectorAll('a:not([href])').forEach(() => {
    issues.push({
      element: 'a',
      issue: 'Link without href attribute',
      severity: 'serious',
      recommendation: 'Add href or use a button element',
    });
  });

  console.log('[AccessibilityAudit] Issues found:', issues.length);
  issues.forEach(issue => {
    console.log(`[${issue.severity.toUpperCase()}] ${issue.element}: ${issue.issue}`);
  });

  return issues;
}

// ============= Global Exposure =============

declare global {
  interface Window {
    runAccessibilityAudit: typeof runAccessibilityAudit;
    announceToScreenReader: typeof announceToScreenReader;
  }
}

if (typeof window !== 'undefined') {
  window.runAccessibilityAudit = runAccessibilityAudit;
  window.announceToScreenReader = announceToScreenReader;
}
