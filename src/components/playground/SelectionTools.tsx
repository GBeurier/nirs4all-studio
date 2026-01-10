/**
 * SelectionTools - Interactive selection tools for charts
 *
 * Features:
 * - Lasso selection (freeform path)
 * - Box/rectangle selection
 * - Selection mode toggle (click/lasso/box)
 * - Shift/Ctrl modifier handling for add/toggle modes
 * - SVG-based rendering for overlay on charts
 *
 * Phase 1 Implementation - Foundation & Selection System
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import { MousePointer2, Square, Lasso } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { type SelectionToolType } from '@/context/SelectionContext';

// Re-export for convenience
export type { SelectionToolType };

// ============= Types =============

export interface Point {
  x: number;
  y: number;
}

export interface SelectionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LassoSelectionResult {
  path: Point[];
  bounds: SelectionBounds;
}

export interface BoxSelectionResult {
  start: Point;
  end: Point;
  bounds: SelectionBounds;
}

export type SelectionResult = LassoSelectionResult | BoxSelectionResult;

// ============= Geometry Utilities =============

/**
 * Check if a point is inside a polygon using ray casting algorithm
 */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const { x, y } = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Check if a point is inside a bounding box
 */
export function isPointInBox(point: Point, bounds: SelectionBounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/**
 * Calculate bounding box from a set of points
 */
export function getBoundsFromPoints(points: Point[]): SelectionBounds {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

/**
 * Calculate bounding box from two corners
 */
export function getBoundsFromCorners(start: Point, end: Point): SelectionBounds {
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
}

/**
 * Simplify a path by removing points that are too close together
 */
export function simplifyPath(points: Point[], tolerance: number = 2): Point[] {
  if (points.length < 3) return points;

  const simplified: Point[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const current = points[i];
    const distance = Math.sqrt(
      Math.pow(current.x - prev.x, 2) + Math.pow(current.y - prev.y, 2)
    );

    if (distance >= tolerance) {
      simplified.push(current);
    }
  }

  simplified.push(points[points.length - 1]);
  return simplified;
}

/**
 * Convert path points to SVG path string
 */
export function pointsToSvgPath(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }
  path += ' Z';
  return path;
}

// ============= Selection Mode Toggle =============

interface SelectionModeToggleProps {
  mode: SelectionToolType;
  onChange: (mode: SelectionToolType) => void;
  className?: string;
}

export function SelectionModeToggle({
  mode,
  onChange,
  className,
}: SelectionModeToggleProps) {
  const tools: { type: SelectionToolType; icon: typeof MousePointer2; label: string; shortcut: string }[] = [
    { type: 'click', icon: MousePointer2, label: 'Click to select', shortcut: 'V' },
    { type: 'box', icon: Square, label: 'Box selection', shortcut: 'B' },
    { type: 'lasso', icon: Lasso, label: 'Lasso selection', shortcut: 'L' },
  ];

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'v':
          onChange('click');
          break;
        case 'b':
          onChange('box');
          break;
        case 'l':
          onChange('lasso');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onChange]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('flex items-center gap-0.5 p-0.5 bg-muted rounded-md', className)}>
        {tools.map(({ type, icon: Icon, label, shortcut }) => (
          <Tooltip key={type}>
            <TooltipTrigger asChild>
              <Button
                variant={mode === type ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-6 w-6 p-0',
                  mode === type && 'bg-background shadow-sm'
                )}
                onClick={() => onChange(type)}
              >
                <Icon className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {label} ({shortcut})
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

// ============= Selection Overlay =============

interface SelectionOverlayProps {
  /** Current selection tool mode */
  mode: SelectionToolType;
  /** Whether selection is currently active */
  isActive: boolean;
  /** Current lasso path (for lasso mode) */
  lassoPath?: Point[];
  /** Current box selection (for box mode) */
  boxSelection?: { start: Point; end: Point };
  /** Container dimensions */
  width: number;
  height: number;
  /** Custom styling */
  className?: string;
}

export function SelectionOverlay({
  mode,
  isActive,
  lassoPath,
  boxSelection,
  width,
  height,
  className,
}: SelectionOverlayProps) {
  if (!isActive) return null;

  return (
    <svg
      className={cn(
        'absolute inset-0 pointer-events-none z-10',
        className
      )}
      width={width}
      height={height}
    >
      <defs>
        <pattern
          id="selection-pattern"
          patternUnits="userSpaceOnUse"
          width="4"
          height="4"
        >
          <path
            d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2"
            stroke="hsl(var(--primary))"
            strokeWidth="0.5"
            opacity="0.3"
          />
        </pattern>
      </defs>

      {/* Lasso path */}
      {mode === 'lasso' && lassoPath && lassoPath.length > 1 && (
        <path
          d={pointsToSvgPath(lassoPath)}
          fill="url(#selection-pattern)"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          strokeDasharray="4 2"
          fillOpacity="0.1"
        />
      )}

      {/* Box selection */}
      {mode === 'box' && boxSelection && (
        <rect
          x={Math.min(boxSelection.start.x, boxSelection.end.x)}
          y={Math.min(boxSelection.start.y, boxSelection.end.y)}
          width={Math.abs(boxSelection.end.x - boxSelection.start.x)}
          height={Math.abs(boxSelection.end.y - boxSelection.start.y)}
          fill="url(#selection-pattern)"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          strokeDasharray="4 2"
          fillOpacity="0.1"
        />
      )}
    </svg>
  );
}

// ============= Selection Container =============

interface SelectionContainerProps {
  /** Current selection tool mode */
  mode: SelectionToolType;
  /** Callback when selection completes */
  onSelectionComplete: (result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => void;
  /** Callback for single click selection */
  onPointClick?: (point: Point, modifiers: { shift: boolean; ctrl: boolean }) => void;
  /** Callback when clicking on background (selection too small to be valid) */
  onBackgroundClick?: (modifiers: { shift: boolean; ctrl: boolean }) => void;
  /** Whether selection is enabled */
  enabled?: boolean;
  /** Children to render inside the container */
  children: ReactNode;
  /** Additional class names */
  className?: string;
}

export function SelectionContainer({
  mode,
  onSelectionComplete,
  onPointClick,
  onBackgroundClick,
  enabled = true,
  children,
  className,
}: SelectionContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [lassoPath, setLassoPath] = useState<Point[]>([]);
  const [boxStart, setBoxStart] = useState<Point | null>(null);
  const [boxEnd, setBoxEnd] = useState<Point | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  // Store modifiers at drag start to use them at drag end
  const modifiersRef = useRef({ shift: false, ctrl: false });
  // Use refs to track current positions during drag (avoid stale closure issues)
  const boxStartRef = useRef<Point | null>(null);
  const boxEndRef = useRef<Point | null>(null);
  const lassoPathRef = useRef<Point[]>([]);

  // Track container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  const getPointFromEvent = useCallback(
    (e: ReactMouseEvent | globalThis.MouseEvent): Point | null => {
      const container = containerRef.current;
      if (!container) return null;

      const rect = container.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!enabled) return;
      if (e.button !== 0) return; // Only left click

      const point = getPointFromEvent(e);
      if (!point) return;

      if (mode === 'click') {
        // Single click handled by onPointClick
        onPointClick?.(point, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
        return;
      }

      // Store modifiers at drag start
      modifiersRef.current = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
      setIsSelecting(true);

      if (mode === 'lasso') {
        setLassoPath([point]);
        lassoPathRef.current = [point];
      } else if (mode === 'box') {
        setBoxStart(point);
        setBoxEnd(point);
        boxStartRef.current = point;
        boxEndRef.current = point;
      }

      // Prevent text selection during drag
      e.preventDefault();
    },
    [enabled, mode, getPointFromEvent, onPointClick]
  );

  // Use document-level event listeners for robust drag handling
  // This ensures we capture events even if other elements are in the way
  // Using refs to avoid stale closure issues - handlers don't need to be recreated on every state change
  useEffect(() => {
    if (!isSelecting) return;

    const handleDocumentMouseMove = (e: globalThis.MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const point = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      if (mode === 'lasso') {
        lassoPathRef.current = [...lassoPathRef.current, point];
        setLassoPath(lassoPathRef.current);
      } else if (mode === 'box') {
        boxEndRef.current = point;
        setBoxEnd(point);
      }
    };

    const handleDocumentMouseUp = (e: globalThis.MouseEvent) => {
      const modifiers = {
        shift: e.shiftKey || modifiersRef.current.shift,
        ctrl: e.ctrlKey || e.metaKey || modifiersRef.current.ctrl
      };

      let selectionMade = false;

      // Complete selection using refs (which have the latest values)
      if (mode === 'lasso' && lassoPathRef.current.length >= 3) {
        const simplified = simplifyPath(lassoPathRef.current);
        const bounds = getBoundsFromPoints(simplified);
        onSelectionComplete({ path: simplified, bounds }, modifiers);
        selectionMade = true;
      } else if (mode === 'box' && boxStartRef.current && boxEndRef.current) {
        const bounds = getBoundsFromCorners(boxStartRef.current, boxEndRef.current);
        const width = Math.abs(boxEndRef.current.x - boxStartRef.current.x);
        const height = Math.abs(boxEndRef.current.y - boxStartRef.current.y);
        // Only complete if box has meaningful size
        if (width > 5 && height > 5) {
          onSelectionComplete({ start: boxStartRef.current, end: boxEndRef.current, bounds }, modifiers);
          selectionMade = true;
        }
      }

      // If selection was too small (just a click), treat as background click
      if (!selectionMade && !modifiers.shift && !modifiers.ctrl) {
        onBackgroundClick?.(modifiers);
      }

      // Reset state
      setIsSelecting(false);
      setLassoPath([]);
      setBoxStart(null);
      setBoxEnd(null);
      boxStartRef.current = null;
      boxEndRef.current = null;
      lassoPathRef.current = [];
    };

    // Add listeners when selection starts
    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    // Clean up when selection ends or component unmounts
    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [isSelecting, mode, onSelectionComplete, onBackgroundClick]);

  // Cursor style based on mode
  const cursorClass =
    mode === 'lasso'
      ? 'cursor-crosshair'
      : mode === 'box'
        ? 'cursor-crosshair'
        : 'cursor-pointer';

  return (
    <div
      ref={containerRef}
      className={cn('relative', enabled && cursorClass, className)}
      onMouseDown={handleMouseDown}
    >
      {children}
      <SelectionOverlay
        mode={mode}
        isActive={isSelecting}
        lassoPath={lassoPath}
        boxSelection={boxStart && boxEnd ? { start: boxStart, end: boxEnd } : undefined}
        width={containerSize.width}
        height={containerSize.height}
      />
    </div>
  );
}

// ============= Selection Actions Bar =============

interface SelectionActionsBarProps {
  /** Number of selected samples */
  selectedCount: number;
  /** Total number of samples */
  totalCount: number;
  /** Callback to clear selection */
  onClear: () => void;
  /** Callback to invert selection */
  onInvert: () => void;
  /** Callback to select all */
  onSelectAll: () => void;
  /** Callback to pin selected samples */
  onPin?: () => void;
  /** Callback to filter to selection - creates a filter operator that keeps only selected samples */
  onFilterToSelection?: () => void;
  /** Callback to save selection */
  onSave?: () => void;
  /** Whether filter to selection is supported (requires filter operators) */
  filterToSelectionEnabled?: boolean;
  /** Whether actions are visible */
  visible?: boolean;
  /** Additional class names */
  className?: string;
}

export function SelectionActionsBar({
  selectedCount,
  totalCount,
  onClear,
  onInvert,
  onSelectAll,
  onPin,
  onFilterToSelection,
  onSave,
  filterToSelectionEnabled = true,
  visible = true,
  className,
}: SelectionActionsBarProps) {
  if (!visible || selectedCount === 0) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1 bg-primary/10 border border-primary/20 rounded-md text-xs',
          className
        )}
      >
        <span className="font-medium text-primary">
          {selectedCount} of {totalCount} selected
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onClear}
          >
            Clear
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onInvert}
          >
            Invert
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onSelectAll}
          >
            All
          </Button>
          {onPin && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onPin}
            >
              Pin
            </Button>
          )}
          {onFilterToSelection && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-6 px-2 text-xs bg-primary/20 hover:bg-primary/30 text-primary font-medium"
                  onClick={onFilterToSelection}
                  disabled={!filterToSelectionEnabled}
                >
                Filter to Selection
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs">
                Add a filter operator that keeps only the {selectedCount} selected sample{selectedCount !== 1 ? 's' : ''}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
        {onSave && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onSave}
          >
            Save
          </Button>
        )}
        </div>
      </div>
    </TooltipProvider>
  );
}

export default SelectionContainer;
