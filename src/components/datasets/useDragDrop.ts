import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Recursively read directory contents using FileSystem API
 * Used in web mode when folder paths aren't available.
 */
async function readDirectoryRecursive(
  dirEntry: FileSystemDirectoryEntry
): Promise<{ files: File[]; relativePaths: string[] }> {
  const files: File[] = [];
  const relativePaths: string[] = [];

  async function readEntries(
    entry: FileSystemDirectoryEntry,
    pathPrefix: string
  ): Promise<void> {
    return new Promise((resolve) => {
      const reader = entry.createReader();
      const readBatch = () => {
        reader.readEntries(async (entries) => {
          if (entries.length === 0) {
            resolve();
            return;
          }

          for (const e of entries) {
            const entryPath = pathPrefix ? `${pathPrefix}/${e.name}` : e.name;
            if (e.isFile) {
              const fileEntry = e as FileSystemFileEntry;
              const file = await new Promise<File>((res) =>
                fileEntry.file(res)
              );
              files.push(file);
              relativePaths.push(entryPath);
            } else if (e.isDirectory) {
              await readEntries(e as FileSystemDirectoryEntry, entryPath);
            }
          }

          readBatch();
        });
      };
      readBatch();
    });
  }

  await readEntries(dirEntry, "");
  return { files, relativePaths };
}

export interface DroppedContent {
  type: "folder" | "files";
  path: string;
  paths: string[];
  items: File[];
  /** Relative paths within dropped folder (for web mode) */
  relativePaths?: string[];
  /** Folder name (for web mode when path is empty) */
  folderName?: string;
}

export interface UseDragDropOptions {
  onDrop: (content: DroppedContent) => void;
  disabled?: boolean;
}

/**
 * Hook to manage drag-and-drop state.
 */
export function useDragDrop({ onDrop, disabled }: UseDragDropOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const [dropType, setDropType] = useState<"folder" | "files" | "unknown">("unknown");
  const [itemCount, setItemCount] = useState(0);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      dragCounterRef.current++;
      if (dragCounterRef.current === 1) {
        setIsDragging(true);

        const items = e.dataTransfer?.items;
        if (items && items.length > 0) {
          setItemCount(items.length);

          const firstItem = items[0];
          if (firstItem.webkitGetAsEntry) {
            const entry = firstItem.webkitGetAsEntry();
            if (entry?.isDirectory) {
              setDropType("folder");
            } else if (entry?.isFile) {
              setDropType("files");
            } else {
              setDropType("unknown");
            }
          } else {
            setDropType(items.length === 1 ? "unknown" : "files");
          }
        }
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
        setDropType("unknown");
        setItemCount(0);
      }
    },
    [disabled]
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [disabled]
  );

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      dragCounterRef.current = 0;
      setIsDragging(false);
      setDropType("unknown");
      setItemCount(0);

      const items = e.dataTransfer?.items;
      const files = e.dataTransfer?.files;

      if (!items || items.length === 0) return;

      const paths: string[] = [];
      const fileList: File[] = [];
      let isFolder = false;

      const getFilePath = (file: File): string | undefined => {
        if (window.electronApi?.getPathForFile) {
          try {
            const path = window.electronApi.getPathForFile(file);
            if (path) return path;
          } catch {
            // Fallback to file.path.
          }
        }
        return (file as File & { path?: string }).path;
      };

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry?.isDirectory) {
            isFolder = true;
            const file = files?.[i];
            if (file) {
              const filePath = getFilePath(file);
              if (filePath) {
                paths.push(filePath);
              }
              fileList.push(file);
            }
          } else if (entry?.isFile) {
            const file = files?.[i];
            if (file) {
              fileList.push(file);
              const filePath = getFilePath(file);
              if (filePath) {
                paths.push(filePath);
              }
            }
          }
        } else if (files?.[i]) {
          fileList.push(files[i]);
          const filePath = getFilePath(files[i]);
          if (filePath) {
            paths.push(filePath);
          }
        }
      }

      if (isFolder && paths.length === 0 && items.length > 0) {
        const firstItem = items[0];
        if (firstItem.webkitGetAsEntry) {
          const entry = firstItem.webkitGetAsEntry();
          if (entry?.isDirectory) {
            try {
              const { files: folderFiles, relativePaths } =
                await readDirectoryRecursive(entry as FileSystemDirectoryEntry);
              onDrop({
                type: "folder",
                path: "",
                paths: relativePaths,
                items: folderFiles,
                relativePaths,
                folderName: entry.name,
              });
              return;
            } catch (error) {
              console.error("Failed to read folder contents:", error);
            }
          }
        }
      }

      if (paths.length > 0 || fileList.length > 0) {
        onDrop({
          type: isFolder ? "folder" : "files",
          path: paths[0] || "",
          paths,
          items: fileList,
        });
      }
    },
    [disabled, onDrop]
  );

  useEffect(() => {
    if (disabled) return;

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, [disabled, handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  return {
    isDragging,
    dropType,
    itemCount,
  };
}
