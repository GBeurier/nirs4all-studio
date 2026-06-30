import { memo } from 'react';
import { FlaskConical } from 'lucide-react';

export const MainCanvasEmptyState = memo(function MainCanvasEmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center max-w-lg px-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mx-auto mb-6 shadow-lg">
          <FlaskConical className="w-10 h-10 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">
          NIR Preprocessing Playground
        </h2>
        <p className="text-muted-foreground mb-6 text-base">
          Explore and experiment with preprocessing transformations on your spectral data in real-time.
        </p>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-card rounded-lg border p-4 text-left">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-blue-500/10 flex items-center justify-center text-blue-500 text-xs font-bold">1</span>
              Load Data
            </h3>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>Upload CSV file</li>
              <li>Select from workspace</li>
              <li>Use demo data</li>
            </ul>
          </div>
          <div className="bg-card rounded-lg border p-4 text-left">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">2</span>
              Add Operators
            </h3>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>Preprocessing (SNV, SG...)</li>
              <li>Splitters (KFold, SPXY...)</li>
              <li>Combine & reorder</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
});
