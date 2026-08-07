/**
 * Step 2: File Detection & Mapping
 *
 * Shows detected files and allows users to:
 * - Map files to roles (X, Y, metadata)
 * - Assign splits (train, test)
 * - Assign sources for multi-source datasets
 * - Add additional files (via button or drag-and-drop)
 */
import { useState, useCallback, useRef, type DragEvent } from "react";

import { getDetectedFileOverrides, useWizard } from "./useWizard";
import { selectFile } from "@/utils/fileDialogs";
import { detectFilesList } from "@/api/datasets";
import type { DetectedFile } from "@/types/datasets";
import { FileMappingStepFileList } from "./FileMappingStepFileList";
import { FileMappingStepHeader } from "./FileMappingStepHeader";
import {
  FILE_MAPPING_DIALOG_FILTERS,
  buildFallbackDetectedFilesFromFileList,
  buildFallbackDetectedFilesFromPaths,
  extractDroppedFiles,
  getFileMappingValidation,
  getMaxSource,
  mergeFileBlobs,
  shouldStoreDroppedFileBlobs,
} from "./FileMappingStepLogic";
import { FileMappingStepWarnings } from "./FileMappingStepWarnings";

export function FileMappingStep() {
  const { state, dispatch } = useWizard();
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

  const maxSource = getMaxSource(state.files);
  const validation = getFileMappingValidation(state.files);

  const addDetectedFiles = useCallback((files: DetectedFile[]) => {
    dispatch({ type: "ADD_FILES", payload: files });
    for (const [path, options] of Object.entries(getDetectedFileOverrides(files))) {
      dispatch({ type: "SET_FILE_OVERRIDE", payload: { path, options } });
    }
  }, [dispatch]);

  const addFilesFromPaths = useCallback(async (filePaths: string[]) => {
    if (filePaths.length > 0) {
      try {
        const detected = await detectFilesList(filePaths);
        if (detected.files.length > 0) {
          addDetectedFiles(detected.files);
          return;
        }
      } catch {
        // Fallback to format-only detection below.
      }
    }

    dispatch({
      type: "ADD_FILES",
      payload: buildFallbackDetectedFilesFromPaths(filePaths),
    });
  }, [addDetectedFiles, dispatch]);

  const handleAddFiles = async () => {
    try {
      const result = await selectFile(FILE_MAPPING_DIALOG_FILTERS, true);

      if (result) {
        const filePaths = Array.isArray(result) ? result : [result];
        await addFilesFromPaths(filePaths);
      }
    } catch (error) {
      console.error("Failed to add files:", error);
    }
  };

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFileDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);

    const getPathForFile = window.electronApi?.getPathForFile
      ? (file: File) => window.electronApi?.getPathForFile?.(file)
      : undefined;
    const { paths, fileList } = extractDroppedFiles(e.dataTransfer?.files, getPathForFile);
    if (fileList.length === 0) return;

    if (paths.length > 0) {
      try {
        const result = await detectFilesList(paths);
        if (result.files.length > 0) {
          addDetectedFiles(result.files);
          return;
        }
      } catch {
        // Fallback to format-only detection below.
      }
    }

    dispatch({
      type: "ADD_FILES",
      payload: buildFallbackDetectedFilesFromFileList(fileList),
    });

    if (shouldStoreDroppedFileBlobs(state.fileBlobs, paths)) {
      dispatch({ type: "SET_FILE_BLOBS", payload: mergeFileBlobs(state.fileBlobs, fileList) });
    }
  }, [addDetectedFiles, dispatch, state.fileBlobs]);

  const handleUpdateFile = (index: number, updates: Partial<DetectedFile>) => {
    dispatch({ type: "UPDATE_FILE", payload: { index, updates } });
  };

  const handleRemoveFile = (index: number) => {
    dispatch({ type: "REMOVE_FILE", payload: index });
  };

  return (
    <div className="flex-1 flex flex-col gap-4 py-2">
      <FileMappingStepHeader
        sourceType={state.sourceType}
        basePath={state.basePath}
        datasetName={state.datasetName}
        onDatasetNameChange={(datasetName) =>
          dispatch({ type: "SET_DATASET_NAME", payload: datasetName })
        }
      />

      <FileMappingStepWarnings validation={validation} />

      <FileMappingStepFileList
        files={state.files}
        validatedShapes={state.validatedShapes}
        maxSource={maxSource}
        isDraggingOver={isDraggingOver}
        onAddFiles={handleAddFiles}
        onUpdateFile={handleUpdateFile}
        onRemoveFile={handleRemoveFile}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleFileDrop}
      />
    </div>
  );
}
