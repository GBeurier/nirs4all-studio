import { ProcessedData } from '@/types/spectral';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SampleDetailsProps {
  data: ProcessedData;
  sampleIndex: number;
  onClose: () => void;
}

export function SampleDetails({ data, sampleIndex, onClose }: SampleDetailsProps) {
  const sampleId = data.sampleIds?.[sampleIndex] || `Sample ${sampleIndex + 1}`;
  const yValue = data.y[sampleIndex];
  const metadata = data.metadata?.[sampleIndex];

  return (
    <div className="absolute top-4 right-4 z-10 bg-card border border-border rounded-lg shadow-lg p-4 min-w-[200px] max-w-[280px]">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-sm text-foreground">{sampleId}</h4>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Index:</span>
          <span className="font-mono">{sampleIndex}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Y Value:</span>
          <span className="font-mono">{yValue.toFixed(4)}</span>
        </div>

        {metadata && Object.entries(metadata).length > 0 && (
          <>
            <div className="border-t border-border my-2" />
            <div className="text-xs text-muted-foreground mb-1">Metadata</div>
            {Object.entries(metadata).map(([key, value]) => (
              <div key={key} className="flex justify-between text-xs">
                <span className="text-muted-foreground truncate mr-2">{key}:</span>
                <span className="font-mono truncate">{String(value)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
