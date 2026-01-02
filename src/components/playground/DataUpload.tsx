import { useCallback } from 'react';
import { Upload, FileSpreadsheet, Trash2, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SpectralData } from '@/types/spectral';

interface DataUploadProps {
  data: SpectralData | null;
  isLoading: boolean;
  error: string | null;
  onLoadFile: (file: File) => void;
  onLoadDemo: () => void;
  onClear: () => void;
}

export function DataUpload({
  data,
  isLoading,
  error,
  onLoadFile,
  onLoadDemo,
  onClear,
}: DataUploadProps) {
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) onLoadFile(file);
    },
    [onLoadFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onLoadFile(file);
    },
    [onLoadFile]
  );

  if (data) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sidebar-foreground">
            <Database className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Data Loaded</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onClear}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted rounded-md p-2">
            <div className="text-muted-foreground">Samples</div>
            <div className="text-foreground font-mono font-semibold">
              {data.spectra.length}
            </div>
          </div>
          <div className="bg-muted rounded-md p-2">
            <div className="text-muted-foreground">Wavelengths</div>
            <div className="text-foreground font-mono font-semibold">
              {data.wavelengths.length}
            </div>
          </div>
          <div className="col-span-2 bg-muted rounded-md p-2">
            <div className="text-muted-foreground">Range</div>
            <div className="text-foreground font-mono font-semibold">
              {data.wavelengths[0].toFixed(0)} - {data.wavelengths[data.wavelengths.length - 1].toFixed(0)} nm
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-border rounded-lg p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Parsing...</span>
          </div>
        ) : (
          <>
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-2">
              Drag & drop CSV file
            </p>
            <label>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                asChild
              >
                <span>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Browse Files
                </span>
              </Button>
            </label>
          </>
        )}
      </div>

      {error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded-md p-2">
          {error}
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="w-full text-muted-foreground hover:text-foreground"
        onClick={onLoadDemo}
      >
        <Database className="w-4 h-4 mr-2" />
        Load Demo Data
      </Button>
    </div>
  );
}
