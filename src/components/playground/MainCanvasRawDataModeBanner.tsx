import { memo } from 'react';
import { Info } from 'lucide-react';

export const MainCanvasRawDataModeBanner = memo(function MainCanvasRawDataModeBanner() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border-b border-blue-500/20">
      <Info className="w-4 h-4 text-blue-500 shrink-0" />
      <span className="text-xs text-blue-700 dark:text-blue-300">
        <strong>Raw Data Mode:</strong> Viewing original data without preprocessing.
        Add operators from the palette to transform your spectra.
      </span>
    </div>
  );
});
