/**
 * Step 3: Parsing Configuration
 *
 * Configure CSV/file parsing options:
 * - Global settings (delimiter, decimal, header, etc.)
 * - Per-file overrides
 * - Signal type and NA policy
 *
 * This module owns the orchestration: client-side / backend auto-detection,
 * fallbacks, and wizard dispatch. The JSX-heavy presentation pieces live in
 * sibling modules (`ParsingStepForm`, `ParsingStepFileOverride`,
 * `ParsingStepAdvancedOptions`).
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Settings2, RotateCcw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWizard, DEFAULT_PARSING } from "./useWizard";
import { detectDelimiterFromContent } from "./parsingDetection";
import {
  toAutoDetectedParsingOptions,
  toClientDetectedParsingOptions,
  toLegacyDetectedParsingOptions,
} from "./ParsingStepLogic";
import { ParsingForm } from "./ParsingStepForm";
import { FileOverrideRow } from "./ParsingStepFileOverride";
import { AdvancedLoadingOptions } from "./ParsingStepAdvancedOptions";
import { detectFormat, autoDetectFile } from "@/api/datasets";

export function ParsingStep() {
  const { state, dispatch } = useWizard();
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [detectingFiles, setDetectingFiles] = useState<Record<string, boolean>>({});
  const hasAutoDetectedOnMount = useRef(false);

  // Check if we're in web mode (no filesystem access, files are in fileBlobs)
  const isWebMode = !state.basePath && state.fileBlobs.size > 0;

  const handleAutoDetect = useCallback(async () => {
    if (state.files.length === 0) return;

    setAutoDetecting(true);
    try {
      const firstXFile = state.files.find((f) => f.type === "X");
      if (!firstXFile) {
        setAutoDetecting(false);
        return;
      }

      // In web mode, do simple client-side detection from file content
      if (isWebMode) {
        const fileBlob = state.fileBlobs.get(firstXFile.path);
        if (fileBlob) {
          try {
            const content = await fileBlob.text();
            const detected = detectDelimiterFromContent(content);
            dispatch({
              type: "SET_PARSING",
              payload: toClientDetectedParsingOptions(detected),
            });
          } catch (e) {
            console.warn("Client-side detection failed:", e);
          }
        }
        setAutoDetecting(false);
        return;
      }

      // Desktop mode: use backend API for full detection
      const result = await autoDetectFile(firstXFile.path, true);

      if (result.success) {
        // Update parsing options with all detected values
        dispatch({
          type: "SET_PARSING",
          payload: toAutoDetectedParsingOptions(result, DEFAULT_PARSING),
        });

        // Update confidence scores in state
        dispatch({
          type: "SET_DETECTION_RESULTS",
          payload: {
            confidence: result.confidence,
          },
        });
      }
    } catch (error) {
      console.error("Auto-detect failed:", error);
      // Fallback to old detectFormat API
      try {
        const firstXFile = state.files.find((f) => f.type === "X");
        if (firstXFile && !isWebMode) {
          const result = await detectFormat({
            path: firstXFile.path,
            sample_rows: 10,
          });

          if (result) {
            dispatch({
              type: "SET_PARSING",
              payload: toLegacyDetectedParsingOptions(result, DEFAULT_PARSING),
            });
          }
        }
      } catch (fallbackError) {
        console.error("Fallback auto-detect also failed:", fallbackError);
      }
    } finally {
      setAutoDetecting(false);
    }
  }, [state.files, state.fileBlobs, isWebMode, dispatch]);

  // Auto-detect on mount (first time only)
  useEffect(() => {
    if (!hasAutoDetectedOnMount.current && state.files.length > 0) {
      hasAutoDetectedOnMount.current = true;
      handleAutoDetect();
    }
  }, [state.files.length, handleAutoDetect]);

  // Per-file auto-detect for parsing options using nirs4all's AutoDetector
  const handlePerFileAutoDetect = useCallback(async (path: string) => {
    setDetectingFiles((prev) => ({ ...prev, [path]: true }));
    try {
      // In web mode, do client-side detection
      if (isWebMode) {
        const fileBlob = state.fileBlobs.get(path);
        if (fileBlob) {
          try {
            const content = await fileBlob.text();
            const detected = detectDelimiterFromContent(content);
            dispatch({
              type: "SET_FILE_OVERRIDE",
              payload: {
                path,
                options: toClientDetectedParsingOptions(detected),
              },
            });
          } catch (e) {
            console.warn("Client-side per-file detection failed:", e);
          }
        }
        return;
      }

      // Desktop mode: use backend API
      const result = await autoDetectFile(path, true);

      if (result.success) {
        dispatch({
          type: "SET_FILE_OVERRIDE",
          payload: {
            path,
            options: toAutoDetectedParsingOptions(result, DEFAULT_PARSING),
          },
        });
      }
    } catch (error) {
      console.error("Per-file auto-detect failed:", error);
      // Fallback to old detectFormat API (desktop mode only)
      if (!isWebMode) {
        try {
          const fallbackResult = await detectFormat({ path, sample_rows: 10 });
          if (fallbackResult) {
            dispatch({
              type: "SET_FILE_OVERRIDE",
              payload: {
                path,
                options: toLegacyDetectedParsingOptions(fallbackResult, DEFAULT_PARSING),
              },
            });
          }
        } catch (fallbackError) {
          console.error("Fallback per-file auto-detect also failed:", fallbackError);
        }
      }
    } finally {
      setDetectingFiles((prev) => ({ ...prev, [path]: false }));
    }
  }, [dispatch, isWebMode, state.fileBlobs]);

  const handleResetDefaults = () => {
    dispatch({ type: "SET_PARSING", payload: { ...DEFAULT_PARSING } });
  };

  const handleFileOverrideToggle = (path: string) => {
    if (state.perFileOverrides[path]) {
      // Remove override
      dispatch({
        type: "SET_FILE_OVERRIDE",
        payload: { path, options: null },
      });
    } else {
      // Add empty override
      dispatch({
        type: "SET_FILE_OVERRIDE",
        payload: { path, options: {} },
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-4 py-2">
      {/* Global settings */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <Label className="text-base font-medium">Global Settings</Label>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAutoDetect}
              disabled={autoDetecting || state.files.length === 0}
            >
              <Wand2 className="h-4 w-4 mr-1" />
              {autoDetecting ? "Detecting..." : "Auto-detect"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleResetDefaults}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
          </div>
        </div>

        <ParsingForm
          options={state.parsing}
          onChange={(updates) =>
            dispatch({ type: "SET_PARSING", payload: updates })
          }
          confidence={state.confidence}
        />

        <AdvancedLoadingOptions
          parsing={state.parsing}
          onChange={(updates) =>
            dispatch({ type: "SET_PARSING", payload: updates })
          }
        />
      </div>

      {/* Per-file overrides */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-base font-medium">Per-File Overrides</Label>
          <span className="text-xs text-muted-foreground">
            {Object.keys(state.perFileOverrides).length} customized
          </span>
        </div>

        <ScrollArea className="flex-1 border rounded-lg">
          {state.files.length > 0 ? (
            state.files.map((file) => {
              const validated = state.validatedShapes[file.path];
              const rows = validated?.num_rows ?? file.num_rows;
              const cols = validated?.num_columns ?? file.num_columns;
              const hasError = validated?.error != null;
              return (
                <FileOverrideRow
                  key={file.path}
                  filename={file.filename}
                  path={file.path}
                  hasOverride={!!state.perFileOverrides[file.path]}
                  overrides={state.perFileOverrides[file.path] || {}}
                  onToggle={() => handleFileOverrideToggle(file.path)}
                  onChange={(updates) =>
                    dispatch({
                      type: "SET_FILE_OVERRIDE",
                      payload: { path: file.path, options: updates },
                    })
                  }
                  onAutoDetect={() => handlePerFileAutoDetect(file.path)}
                  shape={!hasError && rows != null && cols != null ? { rows, cols } : undefined}
                  isDetecting={detectingFiles[file.path]}
                />
              );
            })

          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No files to configure
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
