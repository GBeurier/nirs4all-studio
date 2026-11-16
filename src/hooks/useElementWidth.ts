import { useCallback, useLayoutEffect, useState } from 'react';

/**
 * Track an element's rendered width so SVG charts can lay out at their real
 * size instead of scaling a fixed viewBox. Returns a callback ref (so elements
 * mounted after a loading state are observed too) and `fallback` until the
 * element is measured or when `ResizeObserver` is unavailable.
 */
export function useElementWidth<T extends HTMLElement>(fallback: number): [(element: T | null) => void, number] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);
  const ref = useCallback((node: T | null) => setElement(node), []);

  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const next = Math.floor(element.getBoundingClientRect().width);
      if (next > 0) setWidth((previous) => (previous === next ? previous : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [ref, width];
}
