/**
 * DatasetSpectraTab - Full spectra visualization tab for dataset detail page
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, RefreshCw, Loader2, AlertCircle, Settings } from "lucide-react";
import { SpectraChart } from "../charts";
import type { PreviewDataResponse } from "@/types/datasets";

interface DatasetSpectraTabProps {
  preview: PreviewDataResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function DatasetSpectraTab({
  preview,
  loading,
  error,
  onRefresh,
}: DatasetSpectraTabProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading spectra data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle className="h-8 w-8 text-destructive mb-4" />
        <p className="text-destructive font-medium mb-2">Failed to load spectra</p>
        <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
          {error}
        </p>
        <Button onClick={onRefresh} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (!preview?.spectra_preview) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <BarChart3 className="h-8 w-8 text-muted-foreground mb-4 opacity-50" />
        <p className="text-muted-foreground">No spectra data available</p>
        <Button onClick={onRefresh} variant="outline" className="mt-4">
          <RefreshCw className="h-4 w-4 mr-2" />
          Load Preview
        </Button>
      </div>
    );
  }

  const spectra = preview.spectra_preview;
  const wavelengthMin = Math.min(...spectra.wavelengths);
  const wavelengthMax = Math.max(...spectra.wavelengths);

  return (
    <div className="space-y-6">
      {/* Main Spectra Chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Spectral Overview
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {spectra.wavelengths.length} points
              </Badge>
              <Button variant="ghost" size="sm" onClick={onRefresh}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <SpectraChart
            wavelengths={spectra.wavelengths}
            meanSpectrum={spectra.mean_spectrum}
            minSpectrum={spectra.min_spectrum}
            maxSpectrum={spectra.max_spectrum}
            width={800}
            height={350}
            xLabel="Wavelength"
            yLabel="Absorbance"
          />
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Mean spectrum with min-max range shading
          </p>
        </CardContent>
      </Card>

      {/* Spectral Statistics */}
      <div className="grid md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Wavelength Range</p>
            <p className="text-lg font-semibold">
              {wavelengthMin.toFixed(0)} - {wavelengthMax.toFixed(0)}
            </p>
            <p className="text-xs text-muted-foreground">
              {preview.summary?.signal_type === "nir" ? "nm" : preview.summary?.signal_type === "mir" ? "cm⁻¹" : "units"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Data Points</p>
            <p className="text-lg font-semibold">
              {spectra.wavelengths.length.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">per spectrum</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Mean Range</p>
            <p className="text-lg font-semibold">
              {Math.min(...spectra.mean_spectrum).toFixed(3)} - {Math.max(...spectra.mean_spectrum).toFixed(3)}
            </p>
            <p className="text-xs text-muted-foreground">absorbance</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Samples</p>
            <p className="text-lg font-semibold">
              {preview.summary?.num_samples?.toLocaleString() || "--"}
            </p>
            <p className="text-xs text-muted-foreground">total</p>
          </CardContent>
        </Card>
      </div>

      {/* Configuration hint */}
      <Card className="border-dashed">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Configure visualization</p>
              <p className="text-xs text-muted-foreground">
                Use the Playground to explore spectra with preprocessing and custom views
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
