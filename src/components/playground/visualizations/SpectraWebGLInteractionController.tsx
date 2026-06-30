import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';

import {
  findClosestSpectraHitLineFromPointer,
  type SpectraWebGLHitTestLine,
} from './spectraWebGLHitTesting';

export interface SpectraWebGLInteractionControllerProps {
  lines: SpectraWebGLHitTestLine[];
  onHover: (index: number | null, event?: MouseEvent) => void;
  onClick: (index: number, event: MouseEvent) => void;
}

export function SpectraWebGLInteractionController({
  lines,
  onHover,
  onClick,
}: SpectraWebGLInteractionControllerProps) {
  const { gl } = useThree();
  const hoveredRef = useRef<number | null>(null);
  const linesRef = useRef(lines);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    const domElement = gl.domElement;

    const findClosestSpectrum = (mouseX: number, mouseY: number): number | null => {
      return findClosestSpectraHitLineFromPointer(
        linesRef.current,
        mouseX,
        mouseY,
        domElement.getBoundingClientRect()
      );
    };

    const handleMouseMove = (event: MouseEvent) => {
      const closest = findClosestSpectrum(event.clientX, event.clientY);
      if (closest !== hoveredRef.current) {
        hoveredRef.current = closest;
        onHover(closest, event);
      }
    };

    const handleMouseClick = (event: MouseEvent) => {
      if (event.detail === 0) return;

      const closest = findClosestSpectrum(event.clientX, event.clientY);
      if (closest !== null) {
        onClick(closest, event);
      }
    };

    const handleMouseLeave = () => {
      if (hoveredRef.current !== null) {
        hoveredRef.current = null;
        onHover(null);
      }
    };

    domElement.addEventListener('mousemove', handleMouseMove);
    domElement.addEventListener('click', handleMouseClick);
    domElement.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      domElement.removeEventListener('mousemove', handleMouseMove);
      domElement.removeEventListener('click', handleMouseClick);
      domElement.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [gl, onHover, onClick]);

  return null;
}
