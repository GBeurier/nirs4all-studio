import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * On-demand frame scheduler for canvas scatter renderers.
 *
 * Draws one frame per request instead of running a permanent animation loop, so an
 * idle plot costs no GPU time. Requests are coalesced into a single animation frame;
 * canvas resizes request a frame by themselves. Orbit controls keep damping
 * animations alive by requesting a frame from their `onChange` callback.
 */
export function useRenderScheduler(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const frameRef = useRef<number | null>(null);
  const renderRef = useRef<() => void>(() => {});

  const requestRender = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      renderRef.current();
    });
  }, []);

  /** Installs the latest draw function and schedules a frame; call it when the draw inputs change. */
  const setRender = useCallback((render: () => void) => {
    renderRef.current = render;
    requestRender();
  }, [requestRender]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resizeObserver = new ResizeObserver(requestRender);
    resizeObserver.observe(canvas);
    window.addEventListener('resize', requestRender);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', requestRender);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [canvasRef, requestRender]);

  return { requestRender, setRender };
}
