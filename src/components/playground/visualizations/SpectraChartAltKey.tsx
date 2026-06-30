/**
 * SpectraChartAltKey - Alt-key press tracking for SpectraChart.
 *
 * Tracks whether the Alt key is currently held, which switches the chart's
 * drag gesture from wavelength-range selection to 2D rectangle selection. The
 * window keydown/keyup listeners are encapsulated here so the orchestrator no
 * longer carries this standalone effect. Behaviour is unchanged.
 */

import { useEffect, useState } from 'react';

export function useAltKeyPressed(): boolean {
  const [isAltKeyPressed, setIsAltKeyPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltKeyPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltKeyPressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return isAltKeyPressed;
}
