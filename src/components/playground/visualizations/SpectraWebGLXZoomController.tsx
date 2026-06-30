import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';

import {
  computeSpectraPanRange,
  computeSpectraWheelZoomRange,
  resetSpectraXViewRange,
  shouldResetSpectraXViewRange,
} from './spectraWebGLZoom';

export interface SpectraWebGLXZoomControllerProps {
  xRange: [number, number];
  onXViewRangeChange: (range: [number, number]) => void;
}

export function SpectraWebGLXZoomController({
  xRange,
  onXViewRangeChange,
}: SpectraWebGLXZoomControllerProps) {
  const { gl } = useThree();
  const isDragging = useRef(false);
  const lastX = useRef(0);
  const viewRange = useRef<[number, number]>([...xRange]);
  const xRangeRef = useRef(xRange);
  const initializedRef = useRef(false);

  useEffect(() => {
    const prevRange = xRangeRef.current;

    xRangeRef.current = xRange;

    if (shouldResetSpectraXViewRange(prevRange, xRange, initializedRef.current)) {
      viewRange.current = resetSpectraXViewRange(xRange);
      initializedRef.current = true;
    }
  }, [xRange]);

  useEffect(() => {
    const domElement = gl.domElement;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      const rect = domElement.getBoundingClientRect();
      const mouseXNorm = (event.clientX - rect.left) / rect.width;
      const nextRange = computeSpectraWheelZoomRange({
        xRange: xRangeRef.current,
        viewRange: viewRange.current,
        mouseXNorm,
        deltaY: event.deltaY,
      });

      viewRange.current = nextRange;
      onXViewRangeChange(nextRange);
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 0) {
        isDragging.current = true;
        lastX.current = event.clientX;
        domElement.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging.current) return;

      const rect = domElement.getBoundingClientRect();
      const dx = event.clientX - lastX.current;
      const nextRange = computeSpectraPanRange({
        xRange: xRangeRef.current,
        viewRange: viewRange.current,
        dxPixels: dx,
        viewportWidth: rect.width,
      });

      viewRange.current = nextRange;
      onXViewRangeChange(nextRange);
      lastX.current = event.clientX;
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      domElement.style.cursor = 'default';
    };

    const handleDoubleClick = () => {
      const nextRange = resetSpectraXViewRange(xRangeRef.current);
      viewRange.current = nextRange;
      onXViewRangeChange(nextRange);
    };

    domElement.addEventListener('wheel', handleWheel, { passive: false });
    domElement.addEventListener('mousedown', handleMouseDown);
    domElement.addEventListener('dblclick', handleDoubleClick);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      domElement.removeEventListener('wheel', handleWheel);
      domElement.removeEventListener('mousedown', handleMouseDown);
      domElement.removeEventListener('dblclick', handleDoubleClick);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [gl, onXViewRangeChange]);

  return null;
}
